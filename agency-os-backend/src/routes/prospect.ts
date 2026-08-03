import { Hono } from 'hono';
import type { Env } from '../types';
import { badRequest, serverError, log } from '../utils/errors';
import { searchPlaces, getPlaceDetails, type PlaceResult } from '../services/places';
import { approveCandidates, discoverCandidates, toProspectResult, type DiscoverySettings } from '../services/prospectDiscovery';
import { readSettings } from './settings';

export const prospectRouter = new Hono<{ Bindings: Env }>();

interface ProspectSearchResult extends PlaceResult {
  alreadyInPipeline: boolean;
  opportunityScore: number;
  recommendedTier: 1 | 2 | 3;
  reasoning: string;
}

prospectRouter.post('/search', async (c) => {
  try {
    const body = await c.req.json() as {
      location?: string;
      industry?: string;
      radius?: number; // retained for API compat; no longer used (was the broken locationBias)
      pageToken?: string | null;
      maxPages?: number;
    };
    const { location, industry, pageToken } = body;

    if (!location) return c.json(badRequest('location is required'), 400);
    if (!industry) return c.json(badRequest('industry is required'), 400);

    const search = await searchPlaces(c.env.GOOGLE_PLACES_API_KEY, industry, location, {
      pageToken: pageToken ?? null,
      maxPages: body.maxPages ?? 3,
    });

    // Look up which place_ids are already in pipeline (don't filter — flag them)
    const placeIds = search.places.map(p => p.placeId).filter(Boolean);
    let existing = new Set<string>();
    if (placeIds.length > 0) {
      const placeholders = placeIds.map(() => '?').join(',');
      const rows = await c.env.DB
        .prepare(`SELECT place_id FROM leads WHERE place_id IN (${placeholders}) AND deleted_at IS NULL`)
        .bind(...placeIds)
        .all();
      existing = new Set((rows.results as Array<{ place_id: string }>).map(r => r.place_id));
    }

    const results: ProspectSearchResult[] = search.places.map(p => toProspectResult(p, existing.has(p.placeId)));

    // Sort by opportunity score desc, then unclaimed first
    results.sort((a, b) => {
      if (a.alreadyInPipeline !== b.alreadyInPipeline) return a.alreadyInPipeline ? 1 : -1;
      return b.opportunityScore - a.opportunityScore;
    });

    return c.json({
      results,
      total: results.length,
      nextPageToken: search.nextPageToken,
      pagesFetched: search.pagesFetched,
    });
  } catch (err) {
    log('error', 'prospect', 'POST /prospect/search failed', err);
    return c.json(serverError(`Search failed: ${(err as Error).message}`), 500);
  }
});

prospectRouter.get('/candidates', async (c) => {
  try {
    const status = c.req.query('status') ?? 'pending';
    if (!['pending', 'approved', 'rejected', 'expired'].includes(status)) return c.json(badRequest('Invalid candidate status'), 400);
    const rows = await c.env.DB.prepare(`
      SELECT * FROM prospect_candidates WHERE status = ?
      ORDER BY opportunity_score DESC, first_seen_at DESC LIMIT 200
    `).bind(status).all();
    return c.json({ candidates: rows.results });
  } catch (err) {
    log('error', 'prospect', 'GET /prospect/candidates failed', err);
    return c.json(serverError(), 500);
  }
});

prospectRouter.get('/inbox-summary', async (c) => {
  try {
    const [counts, lastRun] = await c.env.DB.batch([
      c.env.DB.prepare(`SELECT
        SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) AS pending,
        SUM(CASE WHEN status='pending' AND date(first_seen_at)=date('now') THEN 1 ELSE 0 END) AS newToday,
        SUM(CASE WHEN status='approved' AND approved_at >= datetime('now','-7 days') THEN 1 ELSE 0 END) AS approvedThisWeek,
        SUM(CASE WHEN status='rejected' THEN 1 ELSE 0 END) AS rejected
        FROM prospect_candidates`),
      c.env.DB.prepare(`SELECT id, status, industry, search_location, started_at, new_candidates, error_message
        FROM prospect_search_runs ORDER BY started_at DESC LIMIT 1`),
    ]);
    const row = (counts.results[0] ?? {}) as Record<string, number | null>;
    return c.json({
      pending: Number(row.pending ?? 0), newToday: Number(row.newToday ?? 0),
      approvedThisWeek: Number(row.approvedThisWeek ?? 0), rejected: Number(row.rejected ?? 0),
      lastRun: lastRun.results[0] ?? null,
    });
  } catch (err) {
    log('error', 'prospect', 'GET /prospect/inbox-summary failed', err);
    return c.json(serverError(), 500);
  }
});

prospectRouter.post('/candidates/approve', async (c) => {
  try {
    const body = await c.req.json() as { ids?: number[] };
    if (!Array.isArray(body.ids) || body.ids.length === 0) return c.json(badRequest('ids array required'), 400);
    return c.json(await approveCandidates(c.env, body.ids.map(Number).filter(Number.isInteger)));
  } catch (err) {
    log('error', 'prospect', 'POST /prospect/candidates/approve failed', err);
    return c.json(serverError(), 500);
  }
});

prospectRouter.post('/candidates/reject', async (c) => {
  try {
    const body = await c.req.json() as { ids?: number[] };
    const ids = Array.isArray(body.ids) ? body.ids.map(Number).filter(Number.isInteger).slice(0, 200) : [];
    if (!ids.length) return c.json(badRequest('ids array required'), 400);
    const settings = await readSettings(c.env.DB);
    const days = Math.max(1, Number((settings.discovery as Record<string, unknown>).suppressionDays ?? 90));
    const statement = c.env.DB.prepare(`
      UPDATE prospect_candidates SET status='rejected', rejected_at=datetime('now'),
        suppression_until=datetime('now', ?), updated_at=datetime('now')
      WHERE id=? AND status='pending'
    `);
    const results = await c.env.DB.batch(ids.map((id) => statement.bind(`+${days} days`, id)));
    return c.json({ rejected: results.reduce((sum, result) => sum + Number(result.meta.changes ?? 0), 0) });
  } catch (err) {
    log('error', 'prospect', 'POST /prospect/candidates/reject failed', err);
    return c.json(serverError(), 500);
  }
});

prospectRouter.post('/run-now', async (c) => {
  try {
    const body = await c.req.json().catch(() => ({})) as { industry?: string; location?: string };
    const settings = await readSettings(c.env.DB);
    const discovery = settings.discovery as unknown as DiscoverySettings;
    const industry = body.industry ?? discovery.industries[0];
    const location = body.location ?? discovery.locations[0];
    if (!discovery.industries.includes(industry) || !discovery.locations.includes(location)) {
      return c.json(badRequest('Choose an enabled home-service industry and location'), 400);
    }
    return c.json(await discoverCandidates(c.env, { industry, location, triggerType: 'manual', settings: discovery }));
  } catch (err) {
    log('error', 'prospect', 'POST /prospect/run-now failed', err);
    return c.json(serverError(`Discovery failed: ${(err as Error).message}`), 500);
  }
});

prospectRouter.get('/place/:placeId', async (c) => {
  const { placeId } = c.req.param();
  if (!placeId) return c.json(badRequest('placeId required'), 400);

  try {
    // 24h D1 cache check
    const cached = await c.env.DB
      .prepare("SELECT * FROM leads WHERE place_id = ? AND reviews_fetched_at IS NOT NULL AND reviews_fetched_at > datetime('now', '-24 hours')")
      .bind(placeId)
      .first() as Record<string, unknown> | null;

    if (cached?.google_reviews) {
      return c.json({
        place: {
          placeId,
          name: cached.company,
          phone: cached.phone,
          website: cached.website,
          rating: cached.google_rating,
          reviewCount: cached.google_review_count,
          claimed: !!cached.gbp_claimed,
          reviews: JSON.parse(cached.google_reviews as string),
        },
        cached: true,
      });
    }

    const details = await getPlaceDetails(c.env.GOOGLE_PLACES_API_KEY, placeId);
    return c.json({ place: details, cached: false });
  } catch (err) {
    log('error', 'prospect', `GET /prospect/place/${placeId} failed`, err);
    return c.json(serverError(`Place detail fetch failed: ${(err as Error).message}`), 500);
  }
});

prospectRouter.post('/add-to-pipeline', async (c) => {
  try {
    const body = await c.req.json() as { placeIds?: string[] };
    if (!Array.isArray(body.placeIds) || body.placeIds.length === 0) {
      return c.json(badRequest('placeIds array required'), 400);
    }

    let added = 0;
    let skipped = 0;
    const addedPlaceIds: string[] = [];
    const errors: string[] = [];

    for (const placeId of body.placeIds) {
      // Already in pipeline?
      const dupe = await c.env.DB
        .prepare('SELECT id FROM leads WHERE place_id = ?')
        .bind(placeId)
        .first();
      if (dupe) { skipped++; continue; }

      try {
        const details = await getPlaceDetails(c.env.GOOGLE_PLACES_API_KEY, placeId);

        await c.env.DB.prepare(
          `INSERT INTO leads (
            company, phone, website, has_website, address, city, state,
            place_id, gbp_claimed, gbp_photos_count, gbp_hours,
            google_rating, google_review_count, google_reviews, reviews_fetched_at,
            source, status, enrichment_status
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), 'prospect', 'cold', 'pending')`
        ).bind(
          details.name,
          details.phone,
          details.website,
          details.website ? 1 : 0,
          details.address,
          details.city,
          details.state,
          details.placeId,
          details.claimed ? 1 : 0,
          details.photoCount,
          details.hours ? JSON.stringify(details.hours) : null,
          details.rating,
          details.reviewCount,
          JSON.stringify(details.reviews),
        ).run();
        added++;
        addedPlaceIds.push(placeId);
      } catch (err) {
        skipped++;
        errors.push(`${placeId}: ${(err as Error).message}`);
      }
    }

    return c.json({ added, skipped, addedPlaceIds, errors: errors.slice(0, 10) });
  } catch (err) {
    log('error', 'prospect', 'POST /prospect/add-to-pipeline failed', err);
    return c.json(serverError(), 500);
  }
});
