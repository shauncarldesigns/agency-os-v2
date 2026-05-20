/**
 * Lead-website scraper (Phase 4).
 *
 * Fetches a project's existing website (homepage + up to 3 internal pages),
 * extracts brand voice signals via Claude, and persists them as brand_attributes
 * rows on the project. Designed to run inside a Cloudflare Worker — uses fetch
 * + regex parsing, no Node-only libraries.
 *
 * Failure modes are handled gracefully:
 *  - No website on file → caller skips us entirely
 *  - 4xx/5xx → logged, returns { ok: false }
 *  - robots.txt disallows scraping → returns { ok: false, reason: 'robots' }
 *  - SPA with empty body → returns { ok: false, reason: 'empty' }
 */

import { callClaudeJson } from './claude';
import { buildBrandExtractionPrompt, type ExtractedBrand } from '../prompts/brandExtraction';
import { log } from '../utils/errors';

const USER_AGENT = 'AgencyOSBot/1.0 (+https://agency-os-v2.pages.dev)';
const REQUEST_TIMEOUT_MS = 12_000;
const MAX_HTML_BYTES = 1_500_000;
const MAX_INTERNAL_PAGES = 3;

const PREFERRED_INTERNAL_PATHS = [
  '/about',
  '/about-us',
  '/services',
  '/our-services',
  '/why-us',
  '/why-choose-us',
  '/our-story',
  '/team',
];

export interface ScrapeResult {
  ok: boolean;
  reason?: 'no-website' | 'robots' | 'fetch-failed' | 'empty' | 'extract-failed';
  pagesFetched: number;
  rawTextBytes: number;
  rawText: string;
  extracted: ExtractedBrand | null;
}

export async function scrapeWebsite(
  apiKey: string,
  businessName: string,
  startUrl: string
): Promise<ScrapeResult> {
  const empty: ScrapeResult = { ok: false, pagesFetched: 0, rawTextBytes: 0, rawText: '', extracted: null };

  let origin: URL;
  try {
    origin = new URL(startUrl);
  } catch {
    return { ...empty, reason: 'fetch-failed' };
  }
  if (!/^https?:$/.test(origin.protocol)) {
    return { ...empty, reason: 'fetch-failed' };
  }

  // robots.txt — bail if `User-Agent: *` Disallow covers our targets.
  if (await isDisallowedByRobots(origin)) {
    log('info', 'scraper', `${origin.host} disallows scraping via robots.txt`);
    return { ...empty, reason: 'robots' };
  }

  // 1) Fetch homepage.
  const homepage = await fetchPageText(origin.toString());
  if (!homepage) {
    return { ...empty, reason: 'fetch-failed' };
  }
  if (homepage.text.trim().length < 200) {
    return { ...empty, reason: 'empty', pagesFetched: 1 };
  }

  const pages = [{ url: origin.toString(), text: homepage.text }];

  // 2) Pick up to MAX_INTERNAL_PAGES internal links to crawl.
  const internalUrls = pickInternalLinks(homepage.html, origin);
  for (const url of internalUrls.slice(0, MAX_INTERNAL_PAGES)) {
    const page = await fetchPageText(url);
    if (page && page.text.trim().length > 100) {
      pages.push({ url, text: page.text });
    }
  }

  // 3) Concatenate + send to Claude for extraction.
  const combined = pages.map((p) => `### ${p.url}\n${p.text}`).join('\n\n');
  let extracted: ExtractedBrand | null = null;
  try {
    extracted = await callClaudeJson<ExtractedBrand>(
      apiKey,
      buildBrandExtractionPrompt(businessName, combined),
      { maxTokens: 1500, temperature: 0.2, timeoutMs: 60_000 }
    );
  } catch (err) {
    log('error', 'scraper', 'Brand extraction failed', { err: (err as Error).message });
    return {
      ok: false,
      reason: 'extract-failed',
      pagesFetched: pages.length,
      rawTextBytes: combined.length,
      rawText: combined,
      extracted: null,
    };
  }

  return {
    ok: true,
    pagesFetched: pages.length,
    rawTextBytes: combined.length,
    rawText: combined,
    extracted,
  };
}

// ============================================================================
// HTTP + parsing helpers
// ============================================================================

async function fetchPageText(url: string): Promise<{ html: string; text: string } | null> {
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const ct = res.headers.get('content-type') ?? '';
    if (!ct.includes('html')) return null;
    const reader = res.body?.getReader();
    if (!reader) return null;

    // Read with a hard byte cap so a runaway page doesn't blow our memory.
    const chunks: Uint8Array[] = [];
    let bytesRead = 0;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        bytesRead += value.length;
        if (bytesRead >= MAX_HTML_BYTES) {
          try { await reader.cancel(); } catch { /* ignore */ }
          break;
        }
      }
    }
    const decoder = new TextDecoder('utf-8');
    let html = '';
    for (const c of chunks) html += decoder.decode(c, { stream: true });
    html += decoder.decode();

    const text = htmlToText(html);
    return { html, text };
  } catch (err) {
    log('warn', 'scraper', `fetchPageText failed for ${url}`, { err: (err as Error).message });
    return null;
  }
}

function htmlToText(html: string): string {
  // Drop script + style blocks first so their innerText doesn't leak in.
  let out = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, ' ');

  // Keep certain tags as line breaks so we don't collapse structure.
  out = out
    .replace(/<\/(p|div|li|h[1-6]|section|article|header|footer|nav|main)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n');

  // Strip remaining tags.
  out = out.replace(/<[^>]+>/g, ' ');

  // Decode a few common HTML entities.
  out = out
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");

  // Collapse whitespace, but preserve line breaks for readability.
  out = out
    .split('\n')
    .map((line) => line.replace(/[ \t\f\v]+/g, ' ').trim())
    .filter((line) => line.length > 0)
    .join('\n');

  return out;
}

function pickInternalLinks(html: string, origin: URL): string[] {
  const found = new Set<string>();
  const anchorRe = /<a\b[^>]*\bhref=["']([^"']+)["'][^>]*>/gi;
  let m: RegExpExecArray | null;
  const candidates: string[] = [];

  while ((m = anchorRe.exec(html)) !== null) {
    const raw = m[1].trim();
    if (!raw || raw.startsWith('#') || raw.startsWith('mailto:') || raw.startsWith('tel:')) continue;
    let resolved: URL;
    try {
      resolved = new URL(raw, origin);
    } catch {
      continue;
    }
    if (resolved.host !== origin.host) continue;
    // Drop fragments / query strings for dedup.
    resolved.hash = '';
    const path = resolved.pathname.toLowerCase().replace(/\/+$/, '');
    if (!path || path === '') continue;
    if (found.has(resolved.toString())) continue;
    found.add(resolved.toString());
    candidates.push(resolved.toString());
  }

  // Rank: preferred paths first, then everything else in document order.
  candidates.sort((a, b) => {
    const aIdx = PREFERRED_INTERNAL_PATHS.findIndex((p) => new URL(a).pathname.toLowerCase().startsWith(p));
    const bIdx = PREFERRED_INTERNAL_PATHS.findIndex((p) => new URL(b).pathname.toLowerCase().startsWith(p));
    if (aIdx === -1 && bIdx === -1) return 0;
    if (aIdx === -1) return 1;
    if (bIdx === -1) return -1;
    return aIdx - bIdx;
  });

  return candidates;
}

// ============================================================================
// robots.txt
// ============================================================================

async function isDisallowedByRobots(origin: URL): Promise<boolean> {
  try {
    const robotsUrl = new URL('/robots.txt', origin).toString();
    const res = await fetch(robotsUrl, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) return false; // no robots.txt → allowed
    const text = await res.text();
    return robotsForbidsRoot(text);
  } catch {
    return false; // assume allowed on transient errors
  }
}

/** Returns true only if the wildcard agent has an explicit `Disallow: /` at root. */
function robotsForbidsRoot(text: string): boolean {
  const lines = text.split(/\r?\n/).map((l) => l.replace(/#.*$/, '').trim());
  let inWildcard = false;
  for (const line of lines) {
    if (!line) {
      inWildcard = false;
      continue;
    }
    const [keyRaw, ...rest] = line.split(':');
    const key = keyRaw.toLowerCase().trim();
    const value = rest.join(':').trim();
    if (key === 'user-agent') {
      inWildcard = value === '*';
    } else if (inWildcard && key === 'disallow') {
      if (value === '/' || value === '/*') return true;
    }
  }
  return false;
}
