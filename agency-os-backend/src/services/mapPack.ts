/**
 * Map pack capture via Outscraper Google Maps search (maps/search-v3),
 * reusing the existing OUTSCRAPER_API_KEY credential.
 *
 * Every request carries explicit market coordinates: "near me" results are
 * entirely location-dependent, and an unlocated scrape returns results for
 * wherever the scraper's IP lands — the recorded position would be garbage.
 *
 * Polling discipline mirrors services/outscraper.ts: 8s interval × 120s
 * deadline = 15 polls max per task, and Worker subrequest-cap errors are
 * rethrown immediately so the caller can stop the batch cleanly.
 */

import { log } from '../utils/errors';

const BASE = 'https://api.app.outscraper.com/maps/search-v3';
const POLL_INTERVAL_MS = 8000;
const POLL_TIMEOUT_MS = 120_000;
const ENQUEUE_FETCH_TIMEOUT_MS = 15_000;
const POLL_FETCH_TIMEOUT_MS = 10_000;

export interface MapPackEntry {
  position: number;            // 1-based rank as returned
  placeId: string | null;
  company: string;
  hasWebsite: boolean;
  website: string | null;
  googleRating: number | null;
  reviewCount: number | null;
}

interface OutscraperEnqueueResponse {
  id: string;
  status: string;
  results_location: string;
}

interface OutscraperPlaceRaw {
  place_id?: string | null;
  name?: string | null;
  site?: string | null;
  rating?: number | null;
  reviews?: number | null;
}

interface OutscraperResultsResponse {
  status: 'Success' | 'Pending' | 'In progress' | string;
  // maps/search-v3 nests one array of places per query.
  data?: Array<OutscraperPlaceRaw[]>;
}

/**
 * Capture the ordered local results for one keyword at one market's
 * coordinates. `limit` defaults to 5 — the map pack is the top 3, plus a
 * couple of rows of context below the fold.
 */
export async function captureMapPack(
  apiKey: string,
  keyword: string,
  latitude: number,
  longitude: number,
  limit: number = 5,
): Promise<MapPackEntry[]> {
  const params = new URLSearchParams({
    query: keyword,
    coordinates: `${latitude},${longitude}`,
    limit: String(limit),
    async: 'true',
    language: 'en',
    region: 'US',
  });

  const enqueueRes = await fetch(`${BASE}?${params.toString()}`, {
    method: 'GET',
    headers: { 'X-API-KEY': apiKey },
    signal: AbortSignal.timeout(ENQUEUE_FETCH_TIMEOUT_MS),
  });

  if (!enqueueRes.ok) {
    const errText = await enqueueRes.text();
    log('error', 'mapPack', `enqueue failed: ${enqueueRes.status}`, { errText: errText.slice(0, 200), keyword });
    throw new Error(`Outscraper map pack enqueue failed: ${enqueueRes.status}`);
  }

  const enqueue = await enqueueRes.json() as OutscraperEnqueueResponse;
  if (!enqueue.results_location) {
    throw new Error('Outscraper map pack enqueue returned no results_location');
  }

  const places = await pollResults(apiKey, enqueue.results_location);
  return places.map((place, index) => ({
    position: index + 1,
    placeId: place.place_id ?? null,
    company: place.name ?? 'Unknown business',
    hasWebsite: Boolean(place.site?.trim()),
    website: place.site?.trim() || null,
    googleRating: typeof place.rating === 'number' ? place.rating : null,
    reviewCount: typeof place.reviews === 'number' ? place.reviews : null,
  }));
}

async function pollResults(apiKey: string, resultsUrl: string): Promise<OutscraperPlaceRaw[]> {
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
      // Subrequest-cap exhaustion never resolves by retrying inside this
      // invocation — rethrow so the research run stops the batch cleanly.
      if (msg.includes('Too many subrequests')) {
        throw new Error(`Map pack polling abandoned — Worker subrequest cap exhausted: ${msg}`);
      }
      log('warn', 'mapPack', 'poll fetch errored, retrying', { message: msg });
      continue;
    }

    if (!res.ok) {
      const errText = await res.text();
      log('warn', 'mapPack', `poll non-200: ${res.status}`, { errText: errText.slice(0, 200) });
      continue;
    }

    const body = await res.json() as OutscraperResultsResponse;
    if (body.status === 'Success') {
      return body.data?.[0] ?? [];
    }
    // Pending / In progress → keep polling
  }

  throw new Error(`Outscraper map pack polling timed out after ${POLL_TIMEOUT_MS}ms`);
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}
