/**
 * Outscraper Google Maps Reviews — fetch more than the 5 reviews Google's
 * Places API caps us at. Same shape as places.ts `GoogleReview` so callers
 * can merge results without translation.
 *
 * Docs: https://app.outscraper.com/api-docs#tag/Google-Maps-Service/operation/google-maps-reviews-v3
 *
 * Flow: GET enqueue returns 202 with a results URL → poll until the job
 * completes → map review payload into our shape.
 */

import { log } from '../utils/errors';
import type { GoogleReview } from './places';

const BASE = 'https://api.app.outscraper.com/maps/reviews-v3';
// Polling cadence drives the Worker subrequest budget more than anything
// else in this codebase. A 2s interval with a 120s deadline = up to 60
// subrequests per Outscraper task, and bulk enrich blows the Worker's
// 1000-subrequest cap in ~15 leads. 8s × 120s = 15 subrequests max per
// task, ~50 leads safely per bulk. Trades up to 8s of completion latency
// per task (most jobs finish in 30–90s) for 4× the bulk headroom.
const POLL_INTERVAL_MS = 8000;
// Outscraper async jobs for 50 reviews legitimately take 1.5–2 min (observed
// ~118s in prod for 43 reviews). 45s was clipping real jobs and forcing a
// fallback to Google's 5. 120s lets review-heavy leads complete; the per-fetch
// timeouts below bound any single hung request.
const POLL_TIMEOUT_MS = 120_000;
// Per-request timeouts. Without these the overall POLL_TIMEOUT_MS deadline is
// only checked *between* fetches, so a single hung request to Outscraper can
// blow far past 45s and tie up the Worker request (observed ~118s in prod).
const ENQUEUE_FETCH_TIMEOUT_MS = 15_000;
const POLL_FETCH_TIMEOUT_MS = 10_000;

interface OutscraperEnqueueResponse {
  id: string;
  status: string;
  results_location: string;
}

interface OutscraperReviewRaw {
  author_title?: string | null;
  review_text?: string | null;
  review_rating?: number | null;
  review_datetime_utc?: string | null;
  review_timestamp?: number | null;
  review_link?: string | null;
}

interface OutscraperResultsResponse {
  status: 'Success' | 'Pending' | 'In progress' | string;
  data?: Array<{
    reviews_data?: OutscraperReviewRaw[];
  }>;
}

/**
 * Returns up to `limit` reviews for the given Google place_id. Throws on
 * non-recoverable failures (bad key, place not found). Returns [] when the
 * job finishes but Outscraper has no reviews to share — callers should treat
 * that as "use whatever Google gave us."
 */
export async function fetchOutscraperReviews(
  apiKey: string,
  placeId: string,
  limit: number = 50,
): Promise<GoogleReview[]> {
  const url = `${BASE}?query=${encodeURIComponent(placeId)}&reviewsLimit=${limit}&async=true&sort=newest`;

  const enqueueRes = await fetch(url, {
    method: 'GET',
    headers: {
      'X-API-KEY': apiKey,
    },
    signal: AbortSignal.timeout(ENQUEUE_FETCH_TIMEOUT_MS),
  });

  if (!enqueueRes.ok) {
    const errText = await enqueueRes.text();
    log('error', 'outscraper', `enqueue failed: ${enqueueRes.status}`, { errText, placeId });
    throw new Error(`Outscraper enqueue failed: ${enqueueRes.status}`);
  }

  const enqueue = await enqueueRes.json() as OutscraperEnqueueResponse;
  if (!enqueue.results_location) {
    throw new Error('Outscraper enqueue returned no results_location');
  }

  const reviews = await pollResults(apiKey, enqueue.results_location);
  return reviews.map(mapReview).filter(r => r.text.trim().length > 0);
}

async function pollResults(apiKey: string, resultsUrl: string): Promise<OutscraperReviewRaw[]> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;

  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);

    let res: Response;
    try {
      res = await fetch(resultsUrl, {
        headers: { 'X-API-KEY': apiKey },
        signal: AbortSignal.timeout(POLL_FETCH_TIMEOUT_MS),
      });
    } catch (err) {
      const msg = (err as Error).message;
      // Worker subrequest cap is the only fetch error that DOESN'T resolve
      // by retrying — once we're past 1000 subrequests in this invocation,
      // every subsequent fetch fails the same way. Bail immediately so the
      // caller (enrich-all) can stop the batch instead of burning the
      // remaining 60–120s deadline on doomed retries.
      if (msg.includes('Too many subrequests')) {
        throw new Error(`Outscraper polling abandoned — Worker subrequest cap exhausted: ${msg}`);
      }
      // A single hung/aborted poll shouldn't kill the job — log and let the
      // deadline check decide whether to keep trying.
      log('warn', 'outscraper', `poll fetch errored, retrying`, { message: msg });
      continue;
    }

    if (!res.ok) {
      const errText = await res.text();
      log('warn', 'outscraper', `poll non-200: ${res.status}`, { errText });
      continue;
    }

    const body = await res.json() as OutscraperResultsResponse;
    if (body.status === 'Success') {
      return body.data?.[0]?.reviews_data ?? [];
    }
    // Pending / In progress → keep polling
  }

  throw new Error(`Outscraper polling timed out after ${POLL_TIMEOUT_MS}ms`);
}

function mapReview(r: OutscraperReviewRaw): GoogleReview {
  const publishTime = r.review_datetime_utc
    ?? (r.review_timestamp ? new Date(r.review_timestamp * 1000).toISOString() : '');
  return {
    author: r.author_title ?? 'Anonymous',
    rating: r.review_rating ?? 0,
    text: r.review_text ?? '',
    relativeTime: '',
    publishTime,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

/**
 * Dedupe two review arrays by author + publishTime. Keeps the order of `a`
 * (typically Google's curated 5) then appends unique entries from `b`.
 */
export function mergeReviews(a: GoogleReview[], b: GoogleReview[]): GoogleReview[] {
  const seen = new Set<string>();
  const key = (r: GoogleReview) => `${r.author.toLowerCase().trim()}|${r.publishTime}`;
  const out: GoogleReview[] = [];

  for (const r of a) {
    const k = key(r);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(r);
  }
  for (const r of b) {
    const k = key(r);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(r);
  }
  return out;
}
