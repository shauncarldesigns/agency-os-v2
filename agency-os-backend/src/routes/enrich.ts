import { Hono } from 'hono';
import type { Env, Lead } from '../types';
import { badRequest, notFound, serverError, log } from '../utils/errors';
import { getPlaceDetails, searchPlaces } from '../services/places';
import { getPageSpeedReport } from '../services/pagespeed';
import { fetchOutscraperReviews, mergeReviews } from '../services/outscraper';
import { mineReviews } from '../services/reviewMiner';
import { calculateOpportunityScore, recentReviewActivity } from '../services/scoring';

export const enrichRouter = new Hono<{ Bindings: Env }>();

// Bulk enrich — runs leads sequentially (one at a time so we don't blow API quotas).
// Two modes:
//   • Body { ids: [...] }     → re-enrich those specific leads, regardless of
//                                current enrichment_status. Used by the
//                                pipeline bulk-select re-enrich flow.
//   • Body omitted / no ids   → enrich every 'pending' lead (legacy behavior).
// Always skips dead + soft-deleted leads as a safety guard.
enrichRouter.post('/enrich-all', async (c) => {
  try {
    const body = await c.req.json().catch(() => ({})) as { limit?: number; ids?: number[] };
    const limit = Math.min(body.limit ?? 25, 100);

    let ids: number[];
    if (Array.isArray(body.ids) && body.ids.length > 0) {
      const numericIds = body.ids
        .map((v) => Number(v))
        .filter((n) => Number.isFinite(n) && n > 0);
      if (numericIds.length === 0) {
        return c.json(badRequest('ids must contain at least one valid lead id'), 400);
      }
      const capped = numericIds.slice(0, limit);
      const placeholders = capped.map(() => '?').join(',');
      const valid = await c.env.DB
        .prepare(
          `SELECT id FROM leads
           WHERE id IN (${placeholders})
             AND status != 'dead'
             AND deleted_at IS NULL`
        )
        .bind(...capped)
        .all();
      ids = (valid.results as Array<{ id: number }>).map(r => r.id);
    } else {
      const pending = await c.env.DB
        .prepare("SELECT id FROM leads WHERE enrichment_status = 'pending' AND status != 'dead' AND deleted_at IS NULL LIMIT ?")
        .bind(limit)
        .all();
      ids = (pending.results as Array<{ id: number }>).map(r => r.id);
    }
    let succeeded = 0;
    let failed = 0;
    const failures: Array<{ id: number; error: string }> = [];
    let stoppedAt: number | null = null;
    let stopReason: string | null = null;

    for (const id of ids) {
      try {
        await enrichLead(c.env, id);
        succeeded++;
      } catch (err) {
        failed++;
        const msg = (err as Error).message;
        failures.push({ id, error: msg });
        log('error', 'enrich', `Lead ${id} enrichment failed`, err);
        await c.env.DB
          .prepare("UPDATE leads SET enrichment_status = 'failed', enrichment_error = ?, updated_at = datetime('now') WHERE id = ?")
          .bind(msg.slice(0, 500), id)
          .run();

        // Subrequest exhaustion is a per-Worker-invocation hard cap. Once we
        // hit it, every downstream subrequest in this same invocation will
        // also fail — there's no point continuing the loop. Leave the
        // remaining leads in their current state (typically 'pending' or
        // their prior 'enriched') so the operator can retry them in a
        // fresh invocation rather than have them all marked failed.
        if (msg.includes('Too many subrequests')) {
          stoppedAt = id;
          stopReason = 'subrequest_budget_exhausted';
          log('error', 'enrich', `Hit Worker subrequest cap on lead ${id} — aborting batch with ${ids.indexOf(id) + 1}/${ids.length} processed`);
          break;
        }
      }
    }

    const processed = stoppedAt !== null ? ids.indexOf(stoppedAt) + 1 : ids.length;
    return c.json({
      total: ids.length,
      processed,
      succeeded,
      failed,
      failures: failures.slice(0, 10),
      stoppedEarly: stopReason,
      remainingUnprocessed: stoppedAt !== null ? ids.length - processed : 0,
    });
  } catch (err) {
    log('error', 'enrich', 'POST /enrich-all failed', err);
    return c.json(serverError(), 500);
  }
});

// Single-lead enrich (mounted at /api/leads/:id/enrich via leadEnrichRouter below)
export const leadEnrichRouter = new Hono<{ Bindings: Env }>();

leadEnrichRouter.post('/:id/enrich', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) return c.json(badRequest('Invalid lead ID'), 400);

  const lead = await c.env.DB.prepare('SELECT id FROM leads WHERE id = ?').bind(id).first();
  if (!lead) return c.json(notFound('Lead'), 404);

  try {
    const updated = await enrichLead(c.env, id);
    return c.json({ lead: updated });
  } catch (err) {
    log('error', 'enrich', `POST /leads/${id}/enrich failed`, err);
    await c.env.DB
      .prepare("UPDATE leads SET enrichment_status = 'failed', enrichment_error = ?, updated_at = datetime('now') WHERE id = ?")
      .bind((err as Error).message.slice(0, 500), id)
      .run();
    return c.json(serverError(`Enrichment failed: ${(err as Error).message}`), 500);
  }
});

// Core enrichment pipeline — Places (resolve if no place_id) → PageSpeed → review mining → scoring
export async function enrichLead(env: Env, leadId: number): Promise<Lead> {
  const lead = await env.DB.prepare('SELECT * FROM leads WHERE id = ?').bind(leadId).first<Lead>();
  if (!lead) throw new Error('Lead not found');

  // Mark enriching
  await env.DB
    .prepare("UPDATE leads SET enrichment_status = 'enriching', enrichment_error = NULL, updated_at = datetime('now') WHERE id = ?")
    .bind(leadId)
    .run();

  // 1. Resolve place_id if missing (best-effort, search by company + city)
  let placeId = lead.place_id;
  if (!placeId && lead.city) {
    try {
      const searchRes = await searchPlaces(env.GOOGLE_PLACES_API_KEY, lead.company, lead.city, { maxPages: 1 });
      const matches = searchRes.places;
      const best = matches.find(m => fuzzyMatchName(m.name, lead.company)) ?? matches[0];
      if (best) placeId = best.placeId;
    } catch (err) {
      log('warn', 'enrich', `Place resolve failed for lead ${leadId}`, err);
    }
  }

  // 2. Pull GBP details (reviews, photos, hours, claimed signals)
  let placeData: Awaited<ReturnType<typeof getPlaceDetails>> | null = null;
  if (placeId) {
    try {
      placeData = await getPlaceDetails(env.GOOGLE_PLACES_API_KEY, placeId);
    } catch (err) {
      log('warn', 'enrich', `Place detail failed for lead ${leadId}`, err);
    }
  }

  // If we couldn't get place data AND the lead has no preexisting place data
  // to fall back on, the rest of the pipeline produces a thin/empty enrichment
  // that misleads the operator into thinking the lead was successfully
  // processed. Mark failed instead so the operator can retry or fix the input
  // data (a re-enriched lead with existing data still goes through — the
  // COALESCE fields below preserve whatever was already there).
  const hadPreviousPlaceData = !!lead.place_id && !!lead.google_reviews;
  if (!placeData && !hadPreviousPlaceData) {
    const reason = placeId
      ? 'Google Places details fetch failed — try again later or check API key'
      : `Could not resolve Google Places match for "${lead.company}" in ${lead.city ?? 'unknown city'}`;
    throw new Error(reason);
  }

  // 2b + 3. Outscraper review backfill and PageSpeed both depend only on
  // step-2 outputs and don't touch each other, so run them in parallel —
  // each can take 30–90s on its own and serializing them roughly doubled
  // wall-clock enrich time. Promise.allSettled so one's failure doesn't
  // poison the other.
  const websiteUrl = placeData?.website ?? lead.website;
  let pagespeedMobile: number | null = lead.pagespeed_mobile;
  let pagespeedDesktop: number | null = lead.pagespeed_desktop;

  const outscraperTask: Promise<typeof placeData> = (placeData && placeId && env.OUTSCRAPER_API_KEY)
    ? fetchOutscraperReviews(env.OUTSCRAPER_API_KEY, placeId, 50).then(extra => {
        const merged = mergeReviews(placeData!.reviews, extra);
        log('info', 'enrich', `Outscraper reviews for lead ${leadId}`, {
          googleCount: placeData!.reviews.length,
          outscraperCount: extra.length,
          mergedCount: merged.length,
        });
        return { ...placeData!, reviews: merged };
      })
    : Promise.resolve(placeData);

  const pagespeedTask: Promise<{ mobile: number; desktop: number } | null> = websiteUrl
    ? getPageSpeedReport(env.GOOGLE_PLACES_API_KEY, websiteUrl).then(ps => ({
        mobile: ps.mobile,
        desktop: ps.desktop,
      }))
    : Promise.resolve(null);

  const [outscraperResult, pagespeedResult] = await Promise.allSettled([outscraperTask, pagespeedTask]);

  if (outscraperResult.status === 'fulfilled') {
    placeData = outscraperResult.value;
  } else {
    log('warn', 'enrich', `Outscraper fetch failed for lead ${leadId} — falling back to Google reviews`, outscraperResult.reason);
  }

  if (pagespeedResult.status === 'fulfilled' && pagespeedResult.value) {
    pagespeedMobile = pagespeedResult.value.mobile;
    pagespeedDesktop = pagespeedResult.value.desktop;
  } else if (pagespeedResult.status === 'rejected') {
    log('warn', 'enrich', `PageSpeed failed for lead ${leadId}`, pagespeedResult.reason);
  }

  // 4. Review mining via Claude (only if we have reviews)
  let mined: Awaited<ReturnType<typeof mineReviews>> | null = null;
  if (placeData?.reviews?.length) {
    try {
      mined = await mineReviews(
        env.CLAUDE_API_KEY,
        placeData.name || lead.company,
        placeData.city ?? lead.city ?? 'Unknown',
        placeData.reviews
      );
    } catch (err) {
      log('warn', 'enrich', `Review mining failed for lead ${leadId}`, err);
    }
  }

  // 5. Score
  const score = calculateOpportunityScore({
    hasWebsite: !!websiteUrl,
    pagespeedMobile,
    pagespeedDesktop,
    gbpClaimed: placeData?.claimed ?? !!lead.gbp_claimed,
    gbpPhotos: placeData?.photoCount ?? lead.gbp_photos_count ?? 0,
    gbpHasDescription: placeData?.hasDescription ?? false,
    gbpHasHours: placeData?.hasHours ?? false,
    reviewCount: placeData?.reviewCount ?? lead.google_review_count ?? 0,
    rating: placeData?.rating ?? lead.google_rating,
    recentReviewActivity: placeData?.reviews ? recentReviewActivity(placeData.reviews) : false,
    yearsInBusiness: null,
  });

  // 6. Persist
  await env.DB.prepare(`
    UPDATE leads SET
      place_id = ?,
      gbp_claimed = ?,
      gbp_photos_count = ?,
      gbp_categories = ?,
      gbp_hours = ?,
      google_rating = ?,
      google_review_count = ?,
      google_reviews = ?,
      reviews_fetched_at = ?,
      website = COALESCE(?, website),
      has_website = ?,
      pagespeed_mobile = ?,
      pagespeed_desktop = ?,
      address = COALESCE(?, address),
      city = COALESCE(?, city),
      state = COALESCE(?, state),
      phone = COALESCE(?, phone),
      industry = COALESCE(?, industry),
      extracted_services = ?,
      extracted_service_areas = ?,
      extracted_strengths = ?,
      extracted_local_landmarks = ?,
      pitch_quotes = ?,
      owner_names = ?,
      opportunity_score = ?,
      opportunity_reasoning = ?,
      recommended_tier = ?,
      enrichment_status = 'enriched',
      enrichment_error = NULL,
      updated_at = datetime('now')
    WHERE id = ?
  `).bind(
    placeId ?? lead.place_id,
    placeData ? (placeData.claimed ? 1 : 0) : lead.gbp_claimed,
    placeData?.photoCount ?? lead.gbp_photos_count,
    placeData?.types ? JSON.stringify(placeData.types) : lead.gbp_categories,
    placeData?.hours ? JSON.stringify(placeData.hours) : lead.gbp_hours,
    placeData?.rating ?? lead.google_rating,
    placeData?.reviewCount ?? lead.google_review_count,
    placeData?.reviews ? JSON.stringify(placeData.reviews) : lead.google_reviews,
    placeData?.reviews ? new Date().toISOString() : lead.reviews_fetched_at,
    websiteUrl ?? null,
    websiteUrl ? 1 : 0,
    pagespeedMobile,
    pagespeedDesktop,
    placeData?.address ?? null,
    placeData?.city ?? null,
    placeData?.state ?? null,
    placeData?.phone ?? null,
    placeData?.primaryType ?? null,
    mined ? JSON.stringify(mined.services_performed) : null,
    mined ? JSON.stringify(mined.service_areas) : null,
    mined ? JSON.stringify(mined.strengths) : null,
    mined ? JSON.stringify(mined.local_landmarks) : null,
    mined ? JSON.stringify(mined.pitch_quotes) : null,
    mined ? JSON.stringify(mined.owner_names) : null,
    score.score,
    score.reasoning || null,
    score.tier,
    leadId,
  ).run();

  const updated = await env.DB.prepare('SELECT * FROM leads WHERE id = ?').bind(leadId).first<Lead>();
  if (!updated) throw new Error('Lead disappeared after update');
  log('info', 'enrich', `Lead ${leadId} enriched`, { score: score.score, tier: score.tier });
  return updated;
}

function fuzzyMatchName(a: string, b: string): boolean {
  const n = (s: string) => s.toLowerCase().replace(/[^\w\s]/g, '').trim();
  return n(a) === n(b) || n(a).includes(n(b)) || n(b).includes(n(a));
}
