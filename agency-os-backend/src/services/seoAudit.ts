import type { Env, Project } from '../types';
import { log } from '../utils/errors';

const USER_AGENT = 'AgencyOSAuditBot/1.0 (+https://app.shauncarldesigns.com)';
const MAX_PAGES = 50;
const MAX_HTML_BYTES = 1_000_000;
const FETCH_TIMEOUT_MS = 12_000;

type Severity = 'critical' | 'warning' | 'opportunity';
interface Finding { pageId: number | null; pageUrl: string | null; severity: Severity; ruleKey: string; title: string; details: string; fingerprint: string }
interface AuditPage {
  url: string; statusCode: number; redirectCount: number; title: string | null; metaDescription: string | null; canonicalUrl: string | null;
  h1Count: number; wordCount: number; internalLinks: string[]; images: number; imagesMissingAlt: number;
  hasSchema: boolean; isIndexable: boolean; inSitemap: boolean; pageId: number | null;
}

export interface SeoAuditSummary {
  id: number; project_id: number; status: 'running' | 'complete' | 'failed'; start_url: string;
  pages_crawled: number; critical_count: number; warning_count: number; opportunity_count: number;
  health_score: number | null; robots_status: string | null; sitemap_status: string | null;
  error_message: string | null; started_at: string; completed_at: string | null;
}

export async function runSeoAudit(env: Env, project: Project): Promise<SeoAuditSummary> {
  const rawUrl = project.custom_domain ?? project.landingsite_url;
  if (!rawUrl) throw new Error('Project has no live website URL');
  const start = normalizeStartUrl(rawUrl);
  if (!isSafePublicUrl(start)) throw new Error('Website URL is not a public HTTP address');
  const insert = await env.DB.prepare('INSERT INTO seo_audit_runs (project_id, start_url) VALUES (?, ?)')
    .bind(project.id, start.toString()).run();
  const runId = Number(insert.meta.last_row_id);

  try {
    const [robots, sitemap] = await Promise.all([fetchRobots(start), fetchSitemap(start)]);
    const sitemapUrls = new Set(sitemap.urls.map(normalizeComparableUrl));
    const storedPages = await env.DB.prepare("SELECT id, published_url, slug FROM pages WHERE project_id=? AND status='complete'")
      .bind(project.id).all<{ id: number; published_url: string | null; slug: string | null }>();
    const pageMap = buildPageMap(start, storedPages.results ?? []);
    const pages = await crawlSite(start, sitemap.urls, sitemapUrls, pageMap);
    const findings = buildFindings(pages, robots.status, sitemap.status, pageMap);
    await addDuplicateFindings(pages, findings);

    const pageStatements = pages.map((page) => env.DB.prepare(`INSERT INTO seo_audit_pages
      (run_id, project_id, page_id, url, status_code, redirect_count, title, meta_description, canonical_url, h1_count, word_count, internal_links, images, images_missing_alt, has_schema, is_indexable, in_sitemap)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(runId, project.id, page.pageId, page.url, page.statusCode, page.redirectCount, page.title, page.metaDescription, page.canonicalUrl,
        page.h1Count, page.wordCount, page.internalLinks.length, page.images, page.imagesMissingAlt, page.hasSchema ? 1 : 0, page.isIndexable ? 1 : 0, page.inSitemap ? 1 : 0));
    const findingStatements = findings.map((finding) => env.DB.prepare(`INSERT INTO seo_audit_findings
      (run_id, project_id, page_id, page_url, severity, rule_key, title, details, fingerprint) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(runId, project.id, finding.pageId, finding.pageUrl, finding.severity, finding.ruleKey, finding.title, finding.details, finding.fingerprint));
    for (let index = 0; index < pageStatements.length; index += 40) await env.DB.batch(pageStatements.slice(index, index + 40));
    for (let index = 0; index < findingStatements.length; index += 40) await env.DB.batch(findingStatements.slice(index, index + 40));

    const counts = findings.reduce((acc, finding) => ({ ...acc, [finding.severity]: acc[finding.severity] + 1 }), { critical: 0, warning: 0, opportunity: 0 });
    const score = Math.max(0, 100 - Math.min(60, counts.critical * 12) - Math.min(30, counts.warning * 3) - Math.min(10, counts.opportunity));
    await env.DB.prepare(`UPDATE seo_audit_runs SET status='complete', pages_crawled=?, critical_count=?, warning_count=?, opportunity_count=?, health_score=?, robots_status=?, sitemap_status=?, completed_at=datetime('now') WHERE id=?`)
      .bind(pages.length, counts.critical, counts.warning, counts.opportunity, score, robots.status, sitemap.status, runId).run();
    await createAuditWork(env.DB, project.id, findings);
    await recordResolvedAuditWork(env.DB, project.id, runId);
    return (await env.DB.prepare('SELECT * FROM seo_audit_runs WHERE id=?').bind(runId).first<SeoAuditSummary>())!;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await env.DB.prepare("UPDATE seo_audit_runs SET status='failed', error_message=?, completed_at=datetime('now') WHERE id=?").bind(message, runId).run();
    log('error', 'seo-audit', `Audit failed for project ${project.id}`, { runId, message });
    throw error;
  }
}

export async function runDueSeoAudits(env: Env, limit = 8): Promise<Array<{ projectId: number; ok: boolean; error?: string }>> {
  const projects = await env.DB.prepare(`SELECT p.* FROM projects p
    WHERE p.status='live' AND p.tier=3 AND COALESCE(p.custom_domain,p.landingsite_url) IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM seo_audit_runs r WHERE r.project_id=p.id AND r.status='complete' AND r.completed_at >= datetime('now','-30 days'))
    ORDER BY COALESCE((SELECT MAX(r.completed_at) FROM seo_audit_runs r WHERE r.project_id=p.id),'1970-01-01') ASC LIMIT ?`)
    .bind(limit).all<Project>();
  const results: Array<{ projectId: number; ok: boolean; error?: string }> = [];
  for (const project of projects.results ?? []) {
    try { await runSeoAudit(env, project); results.push({ projectId: project.id, ok: true }); }
    catch (error) { results.push({ projectId: project.id, ok: false, error: error instanceof Error ? error.message : String(error) }); }
  }
  return results;
}

async function crawlSite(start: URL, sitemapSeed: string[], sitemapUrls: Set<string>, pageMap: Map<string, number>): Promise<AuditPage[]> {
  const queue = [start.toString(), ...sitemapSeed].filter((url, index, all) => all.indexOf(url) === index);
  const seen = new Set<string>();
  const crawledFinal = new Set<string>();
  const pages: AuditPage[] = [];
  while (queue.length && pages.length < MAX_PAGES) {
    const next = queue.shift()!;
    const comparable = normalizeComparableUrl(next);
    if (seen.has(comparable)) continue;
    seen.add(comparable);
    let url: URL;
    try { url = new URL(next, start); } catch { continue; }
    if (!isSameSite(url, start) || !isSafePublicUrl(url) || isAssetPath(url.pathname)) continue;
    const page = await fetchAuditPage(url, start, sitemapUrls, pageMap);
    const finalKey = normalizeComparableUrl(page.url);
    if (!crawledFinal.has(finalKey)) {
      crawledFinal.add(finalKey);
      pages.push(page);
    }
    for (const link of page.internalLinks) if (!seen.has(normalizeComparableUrl(link)) && queue.length + pages.length < MAX_PAGES * 4) queue.push(link);
  }
  return pages;
}

async function fetchAuditPage(url: URL, origin: URL, sitemapUrls: Set<string>, pageMap: Map<string, number>): Promise<AuditPage> {
  const base = { url: url.toString(), redirectCount: 0, title: null, metaDescription: null, canonicalUrl: null, h1Count: 0, wordCount: 0, internalLinks: [] as string[], images: 0, imagesMissingAlt: 0, hasSchema: false, isIndexable: true, inSitemap: sitemapUrls.has(normalizeComparableUrl(url.toString())), pageId: matchPageId(url, pageMap) };
  try {
    const { response, redirectCount } = await fetchFollowingRedirects(url, origin);
    const finalUrl = new URL(response.url);
    if (!isSafePublicUrl(finalUrl) || !isSameSite(finalUrl, origin)) return { ...base, redirectCount, statusCode: response.status };
    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.includes('html') || !response.body) return { ...base, statusCode: response.status };
    const html = await readLimitedBody(response.body);
    const links = extractLinks(html, finalUrl, origin);
    const images = [...html.matchAll(/<img\b[^>]*>/gi)].map((match) => match[0]);
    const robotsMeta = firstMatch(html, /<meta\b[^>]*name=["']robots["'][^>]*content=["']([^"']*)["'][^>]*>/i)
      ?? firstMatch(html, /<meta\b[^>]*content=["']([^"']*)["'][^>]*name=["']robots["'][^>]*>/i);
    return {
      ...base, url: finalUrl.toString(), statusCode: response.status, redirectCount,
      title: cleanText(firstMatch(html, /<title[^>]*>([\s\S]*?)<\/title>/i)),
      metaDescription: cleanText(firstMatch(html, /<meta\b[^>]*name=["']description["'][^>]*content=["']([^"']*)["'][^>]*>/i) ?? firstMatch(html, /<meta\b[^>]*content=["']([^"']*)["'][^>]*name=["']description["'][^>]*>/i)),
      canonicalUrl: firstMatch(html, /<link\b[^>]*rel=["'][^"']*canonical[^"']*["'][^>]*href=["']([^"']+)["'][^>]*>/i),
      h1Count: (html.match(/<h1\b/gi) ?? []).length,
      wordCount: htmlToText(html).split(/\s+/).filter(Boolean).length,
      internalLinks: links,
      images: images.length,
      imagesMissingAlt: images.filter((tag) => !/\balt\s*=\s*["'][^"']+["']/i.test(tag)).length,
      hasSchema: /<script\b[^>]*type=["']application\/ld\+json["']/i.test(html),
      isIndexable: !robotsMeta?.toLowerCase().includes('noindex') && response.headers.get('x-robots-tag')?.toLowerCase().includes('noindex') !== true,
      pageId: matchPageId(finalUrl, pageMap),
    };
  } catch { return { ...base, statusCode: 0 }; }
}

function buildFindings(pages: AuditPage[], robotsStatus: string, sitemapStatus: string, pageMap: Map<string, number>): Finding[] {
  const findings: Finding[] = [];
  const add = (page: AuditPage | null, severity: Severity, ruleKey: string, title: string, details: string) => findings.push({ pageId: page?.pageId ?? null, pageUrl: page?.url ?? null, severity, ruleKey, title, details, fingerprint: `${ruleKey}|${page ? normalizeComparableUrl(page.url) : 'site'}` });
  if (robotsStatus === 'missing') add(null, 'warning', 'robots_missing', 'robots.txt is missing', 'Publish a robots.txt file so crawlers receive explicit site directives.');
  if (robotsStatus === 'blocked') add(null, 'critical', 'robots_blocked', 'Site is blocked in robots.txt', 'The root path is disallowed for general search crawlers.');
  if (sitemapStatus === 'missing') add(null, 'warning', 'sitemap_missing', 'XML sitemap is missing', 'Publish and reference an XML sitemap so search engines can discover every intended page.');
  const inbound = new Map<string, number>();
  for (const page of pages) for (const link of page.internalLinks) inbound.set(normalizeComparableUrl(link), (inbound.get(normalizeComparableUrl(link)) ?? 0) + 1);
  for (const page of pages) {
    if (page.statusCode === 0 || page.statusCode >= 400) add(page, 'critical', 'http_error', 'Page is unavailable', `The crawler received HTTP ${page.statusCode || 'fetch failure'}.`);
    if (page.redirectCount > 1) add(page, 'warning', 'redirect_chain', 'Redirect chain detected', `The requested URL passed through ${page.redirectCount} redirects before loading.`);
    if (!page.title) add(page, 'critical', 'title_missing', 'Page title is missing', 'Add a unique, descriptive HTML title.');
    else if (page.title.length < 20 || page.title.length > 65) add(page, 'warning', 'title_length', 'Page title length needs review', `Current title length is ${page.title.length} characters.`);
    if (!page.metaDescription) add(page, 'warning', 'meta_missing', 'Meta description is missing', 'Add a page-specific search description.');
    else if (page.metaDescription.length < 70 || page.metaDescription.length > 165) add(page, 'opportunity', 'meta_length', 'Meta description length needs review', `Current description length is ${page.metaDescription.length} characters.`);
    if (page.h1Count === 0) add(page, 'critical', 'h1_missing', 'H1 heading is missing', 'Add one primary heading that describes the page topic.');
    if (page.h1Count > 1) add(page, 'warning', 'h1_multiple', 'Multiple H1 headings found', `The page contains ${page.h1Count} H1 headings.`);
    if (!page.canonicalUrl) add(page, 'warning', 'canonical_missing', 'Canonical URL is missing', 'Add a self-referencing canonical URL.');
    if (!page.isIndexable) add(page, 'critical', 'noindex', 'Page is blocked from indexing', 'Remove noindex if this page should appear in search.');
    if (page.wordCount > 0 && page.wordCount < 250) add(page, 'opportunity', 'thin_content', 'Page has limited indexable copy', `Approximately ${page.wordCount} words were found.`);
    if (page.imagesMissingAlt > 0) add(page, 'warning', 'image_alt_missing', 'Images are missing alt text', `${page.imagesMissingAlt} of ${page.images} images need descriptive alt text.`);
    if (!page.hasSchema) add(page, 'opportunity', 'schema_missing', 'Structured data was not detected', 'Consider relevant LocalBusiness, Service, FAQ, or Breadcrumb schema.');
    if (sitemapStatus === 'found' && !page.inSitemap) add(page, 'warning', 'not_in_sitemap', 'Page is not in the sitemap', 'Add this indexable page to the XML sitemap.');
    if (page.inSitemap && normalizePath(new URL(page.url).pathname) !== '/' && !inbound.has(normalizeComparableUrl(page.url))) add(page, 'critical', 'orphan_page', 'Page has no discovered internal links', 'Add a contextual internal link so visitors and search crawlers can reach this page.');
  }
  for (const [path, pageId] of pageMap) {
    if (!pages.some((page) => normalizePath(new URL(page.url).pathname) === path)) findings.push({ pageId, pageUrl: null, severity: 'critical', ruleKey: 'matrix_page_missing', title: 'Live Page Matrix page was not found', details: `The expected path ${path} was not discovered during the crawl.`, fingerprint: `matrix_page_missing|${pageId}` });
  }
  return findings;
}

async function addDuplicateFindings(pages: AuditPage[], findings: Finding[]) {
  for (const [field, rule, label] of [['title', 'title_duplicate', 'title'], ['metaDescription', 'meta_duplicate', 'meta description']] as const) {
    const groups = new Map<string, AuditPage[]>();
    for (const page of pages) { const value = page[field]?.trim().toLowerCase(); if (value) groups.set(value, [...(groups.get(value) ?? []), page]); }
    for (const group of groups.values()) if (group.length > 1) for (const page of group) findings.push({ pageId: page.pageId, pageUrl: page.url, severity: 'warning', ruleKey: rule, title: `Duplicate ${label}`, details: `The same ${label} appears on ${group.length} crawled pages.`, fingerprint: `${rule}|${normalizeComparableUrl(page.url)}` });
  }
}

async function recordResolvedAuditWork(db: D1Database, projectId: number, runId: number) {
  const previous = await db.prepare("SELECT id FROM seo_audit_runs WHERE project_id=? AND status='complete' AND id<? ORDER BY id DESC LIMIT 1").bind(projectId, runId).first<{ id: number }>();
  if (!previous) return;
  const resolved = await db.prepare(`SELECT DISTINCT f.page_id FROM seo_audit_findings f WHERE f.run_id=? AND f.page_id IS NOT NULL AND f.severity IN ('critical','warning')
    AND NOT EXISTS (SELECT 1 FROM seo_audit_findings current WHERE current.run_id=? AND current.page_id=f.page_id AND current.severity IN ('critical','warning'))`).bind(previous.id, runId).all<{ page_id: number }>();
  const cycle = await db.prepare("SELECT id FROM growth_cycles WHERE project_id=? AND period=strftime('%Y-%m','now')").bind(projectId).first<{ id: number }>();
  if (!cycle) return;
  for (const item of resolved.results ?? []) await db.prepare(`UPDATE growth_work_items SET status='complete', completed_at=COALESCE(completed_at,datetime('now')), updated_at=datetime('now')
    WHERE cycle_id=? AND evidence_url=? AND status!='complete'`).bind(cycle.id, `audit-page:${item.page_id}`).run();
}

async function createAuditWork(db: D1Database, projectId: number, findings: Finding[]) {
  const cycle = await db.prepare("SELECT id FROM growth_cycles WHERE project_id=? AND period=strftime('%Y-%m','now')").bind(projectId).first<{ id: number }>();
  if (!cycle) return;
  const project = await db.prepare('SELECT monthly_pages_target FROM projects WHERE id=?').bind(projectId).first<{ monthly_pages_target: number }>();
  const target = Math.max(1, Number(project?.monthly_pages_target) || 3);
  const committed = await db.prepare(`SELECT COUNT(*) AS count FROM growth_work_items WHERE cycle_id=? AND work_tier='committed'
    AND category IN ('created','improved','technical','conversion')`).bind(cycle.id).first<{ count: number }>();
  let committedCount = Number(committed?.count) || 0;
  const byPage = new Map<number, Finding[]>();
  const severityOrder: Record<Severity, number> = { critical: 0, warning: 1, opportunity: 2 };
  const prioritized = [...findings].sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);
  for (const finding of prioritized) if (finding.pageId && finding.severity !== 'opportunity') byPage.set(finding.pageId, [...(byPage.get(finding.pageId) ?? []), finding]);
  for (const [pageId, pageFindings] of [...byPage.entries()].slice(0, 12)) {
    const marker = `audit-page:${pageId}`;
    const title = pageFindings.length === 1 ? pageFindings[0].title : `${pageFindings.length} SEO issues require attention`;
    const description = pageFindings.map((finding) => `${finding.title}: ${finding.details}`).join('\n');
    const category = pageFindings.some((finding) => ['http_error', 'noindex', 'canonical_missing', 'redirect_chain', 'orphan_page'].includes(finding.ruleKey)) ? 'technical' : 'improved';
    const existing = await db.prepare('SELECT id, status FROM growth_work_items WHERE cycle_id=? AND evidence_url=?').bind(cycle.id, marker).first<{ id: number; status: string }>();
    if (existing) {
      if (existing.status !== 'in_progress') await db.prepare("UPDATE growth_work_items SET category=?, title=?, description=?, status='planned', completed_at=NULL, updated_at=datetime('now') WHERE id=?")
        .bind(category, title, description, existing.id).run();
      continue;
    }
    const workTier = committedCount < target ? 'committed' : 'bonus';
    if (workTier === 'committed') committedCount += 1;
    await db.prepare(`INSERT INTO growth_work_items (cycle_id, category, title, description, status, evidence_url, page_id, client_visible, work_tier)
      VALUES (?, ?, ?, ?, 'planned', ?, ?, 1, ?)`).bind(cycle.id, category, title, description, marker, pageId, workTier).run();
  }
}

export async function createAuditWorkForRun(db: D1Database, projectId: number, runId: number): Promise<void> {
  const result = await db.prepare('SELECT page_id, page_url, severity, rule_key, title, details, fingerprint FROM seo_audit_findings WHERE run_id=?')
    .bind(runId).all<{ page_id: number | null; page_url: string | null; severity: Severity; rule_key: string; title: string; details: string; fingerprint: string }>();
  await createAuditWork(db, projectId, (result.results ?? []).map((row) => ({ pageId: row.page_id, pageUrl: row.page_url, severity: row.severity, ruleKey: row.rule_key, title: row.title, details: row.details, fingerprint: row.fingerprint })));
}

async function fetchRobots(origin: URL): Promise<{ status: string }> {
  try { const response = await fetch(new URL('/robots.txt', origin), { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(5000) }); if (!response.ok) return { status: 'missing' }; const text = await response.text(); return { status: /user-agent:\s*\*[\s\S]*?disallow:\s*\/(?:\s|$)/i.test(text) ? 'blocked' : 'found' }; } catch { return { status: 'missing' }; }
}
async function fetchSitemap(origin: URL): Promise<{ status: string; urls: string[] }> {
  try { const response = await fetch(new URL('/sitemap.xml', origin), { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(7000) }); if (!response.ok || !response.body) return { status: 'missing', urls: [] }; const xml = await readLimitedBody(response.body); const urls = [...xml.matchAll(/<loc>\s*([^<]+)\s*<\/loc>/gi)].map((match) => decodeEntities(match[1].trim())).filter((url) => { try { return isSameSite(new URL(url), origin); } catch { return false; } }); return { status: urls.length ? 'found' : 'invalid', urls: urls.slice(0, MAX_PAGES) }; } catch { return { status: 'missing', urls: [] }; }
}
async function fetchFollowingRedirects(start: URL, origin: URL): Promise<{ response: Response; redirectCount: number }> {
  let current = start;
  for (let redirectCount = 0; redirectCount <= 5; redirectCount += 1) {
    const response = await fetch(current, { headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/xhtml+xml' }, redirect: 'manual', signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (response.status < 300 || response.status >= 400) return { response, redirectCount };
    const location = response.headers.get('location');
    if (!location) return { response, redirectCount };
    const next = new URL(location, current);
    if (!isSafePublicUrl(next) || !isSameSite(next, origin)) throw new Error('Redirect left the audited public site');
    current = next;
  }
  throw new Error('Redirect chain exceeded five hops');
}
async function readLimitedBody(stream: ReadableStream<Uint8Array>): Promise<string> { const reader = stream.getReader(); const chunks: Uint8Array[] = []; let total = 0; while (total < MAX_HTML_BYTES) { const { value, done } = await reader.read(); if (done) break; if (value) { chunks.push(value); total += value.length; } } if (total >= MAX_HTML_BYTES) await reader.cancel().catch(() => undefined); const decoder = new TextDecoder(); return chunks.map((chunk, index) => decoder.decode(chunk, { stream: index < chunks.length - 1 })).join(''); }
function extractLinks(html: string, page: URL, origin: URL): string[] { const found = new Set<string>(); for (const match of html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>/gi)) { try { const url = new URL(decodeEntities(match[1]), page); url.hash = ''; if (isSameSite(url, origin) && /^https?:$/.test(url.protocol) && !isAssetPath(url.pathname)) found.add(url.toString()); } catch { /* ignore malformed href */ } } return [...found]; }
function buildPageMap(origin: URL, pages: Array<{ id: number; published_url: string | null; slug: string | null }>): Map<string, number> { const map = new Map<string, number>(); for (const page of pages) { const value = page.published_url ?? page.slug; if (!value) continue; try { map.set(normalizePath(new URL(value, origin).pathname), page.id); } catch { /* ignore */ } } return map; }
function matchPageId(url: URL, map: Map<string, number>): number | null { return map.get(normalizePath(url.pathname)) ?? null; }
function normalizeStartUrl(value: string): URL { const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`); url.hash = ''; return url; }
function normalizeComparableUrl(value: string): string { try { const url = new URL(value); return `${url.hostname.toLowerCase().replace(/^www\./, '')}${normalizePath(url.pathname)}`; } catch { return value.toLowerCase(); } }
function normalizePath(value: string): string { const path = value.replace(/\/+$/, '') || '/'; return path.toLowerCase(); }
function isSameSite(a: URL, b: URL): boolean { return a.hostname.replace(/^www\./, '').toLowerCase() === b.hostname.replace(/^www\./, '').toLowerCase(); }
function isAssetPath(path: string): boolean { return /\.(?:jpe?g|png|gif|webp|svg|pdf|zip|css|js|xml|json|ico|woff2?|ttf)$/i.test(path); }
function isSafePublicUrl(url: URL): boolean { if (!/^https?:$/.test(url.protocol) || url.username || url.password || (url.port && !['80', '443'].includes(url.port))) return false; const host = url.hostname.toLowerCase(); if (host === 'localhost' || host.endsWith('.local') || host === '::1') return false; const parts = host.split('.').map(Number); if (parts.length === 4 && parts.every(Number.isInteger)) { const [a, b] = parts; if (a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) return false; } return true; }
function firstMatch(value: string, regex: RegExp): string | null { return value.match(regex)?.[1]?.trim() ?? null; }
function cleanText(value: string | null): string | null { if (!value) return null; return decodeEntities(value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()); }
function htmlToText(html: string): string { return decodeEntities(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()); }
function decodeEntities(value: string): string { return value.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' '); }
