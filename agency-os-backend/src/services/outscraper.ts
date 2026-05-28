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
const POLL_INTERVAL_MS = 2000;
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
      // A single hung/aborted poll shouldn't kill the job — log and let the
      // deadline check decide whether to keep trying.
      log('warn', 'outscraper', `poll fetch errored, retrying`, { message: (err as Error).message });
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
