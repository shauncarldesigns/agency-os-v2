import { Hono } from 'hono';
import type { Env } from '../types';
import { badRequest, serverError, log } from '../utils/errors';
import { searchPlaces, getPlaceDetails, type PlaceResult } from '../services/places';
import { calculateOpportunityScore } from '../services/scoring';

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

    const results: ProspectSearchResult[] = search.places.map(p => {
      const score = calculateOpportunityScore({
        hasWebsite: !!p.website,
        pagespeedMobile: null,
        pagespeedDesktop: null,
        gbpClaimed: p.claimed,
        gbpPhotos: p.photoCount,
        gbpHasDescription: p.hasDescription,
        gbpHasHours: p.hasHours,
        reviewCount: p.reviewCount ?? 0,
        rating: p.rating,
        recentReviewActivity: false,
        yearsInBusiness: null,
      });

      return {
        ...p,
        alreadyInPipeline: existing.has(p.placeId),
        opportunityScore: score.score,
        recommendedTier: score.tier,
        reasoning: score.reasoning,
      };
    });

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
      } catch (err) {
        skipped++;
        errors.push(`${placeId}: ${(err as Error).message}`);
      }
    }

    return c.json({ added, skipped, errors: errors.slice(0, 10) });
  } catch (err) {
    log('error', 'prospect', 'POST /prospect/add-to-pipeline failed', err);
    return c.json(serverError(), 500);
  }
});
