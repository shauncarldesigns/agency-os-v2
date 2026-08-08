import type { Env } from '../types';
import { calculateOpportunityScore } from './scoring';
import { getPlaceDetails, searchPlaces, type PlaceResult } from './places';
import { readSettings } from '../routes/settings';

export interface DiscoverySettings {
  enabled: boolean;
  websiteMode: 'no_website';
  phoneRequired: boolean;
  industries: string[];
  locations: string[];
  runDays: string[];
  localRunHour: number;
  maxCandidatesPerRun: number;
  inboxLimit: number;
  scoreFloor: number;
  suppressionDays: number;
  expirationDays: number;
}

export interface DiscoveryRunResult {
  runId: number | null;
  status: 'completed' | 'skipped';
  reason?: string;
  industry?: string;
  location?: string;
  resultsFound: number;
  newCandidates: number;
  refreshedCandidates: number;
  skippedExisting: number;
  skippedIneligible: number;
}

function scorePlace(place: PlaceResult) {
  return calculateOpportunityScore({
    hasWebsite: !!place.website,
    pagespeedMobile: null,
    pagespeedDesktop: null,
    gbpClaimed: place.claimed,
    gbpPhotos: place.photoCount,
    gbpHasDescription: place.hasDescription,
    gbpHasHours: place.hasHours,
    reviewCount: place.reviewCount ?? 0,
    rating: place.rating,
    recentReviewActivity: false,
    yearsInBusiness: null,
  });
}

export function toProspectResult(place: PlaceResult, alreadyInPipeline: boolean) {
  const score = scorePlace(place);
  return {
    ...place,
    alreadyInPipeline,
    opportunityScore: score.score,
    recommendedTier: score.tier,
    reasoning: score.reasoning,
  };
}

async function insertRun(
  env: Env,
  triggerType: 'scheduled' | 'manual',
  industry: string,
  location: string,
  scheduledKey?: string,
): Promise<number | null> {
  if (scheduledKey) {
    const result = await env.DB.prepare(`
      INSERT OR IGNORE INTO prospect_search_runs
        (trigger_type, industry, search_location, scheduled_key)
      VALUES (?, ?, ?, ?)
    `).bind(triggerType, industry, location, scheduledKey).run();
    if (!result.meta.changes) return null;
    return Number(result.meta.last_row_id);
  }
  const result = await env.DB.prepare(`
    INSERT INTO prospect_search_runs (trigger_type, industry, search_location)
    VALUES (?, ?, ?)
  `).bind(triggerType, industry, location).run();
  return Number(result.meta.last_row_id);
}

export async function discoverCandidates(
  env: Env,
  input: {
    industry: string;
    location: string;
    triggerType: 'scheduled' | 'manual';
    settings: DiscoverySettings;
    scheduledKey?: string;
  },
): Promise<DiscoveryRunResult> {
  const pending = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM prospect_candidates WHERE status = 'pending'",
  ).first<{ n: number }>();
  const remainingCapacity = Math.max(0, input.settings.inboxLimit - Number(pending?.n ?? 0));
  if (remainingCapacity === 0) {
    return { runId: null, status: 'skipped', reason: 'inbox_limit', resultsFound: 0, newCandidates: 0, refreshedCandidates: 0, skippedExisting: 0, skippedIneligible: 0 };
  }

  const runId = await insertRun(env, input.triggerType, input.industry, input.location, input.scheduledKey);
  if (runId === null) {
    return { runId: null, status: 'skipped', reason: 'already_ran', resultsFound: 0, newCandidates: 0, refreshedCandidates: 0, skippedExisting: 0, skippedIneligible: 0 };
  }

  try {
    const search = await searchPlaces(env.GOOGLE_PLACES_API_KEY, input.industry, input.location, { maxPages: 3 });
    const placeIds = search.places.map((place) => place.placeId);
    const existingLeadIds = new Set<string>();
    if (placeIds.length) {
      const placeholders = placeIds.map(() => '?').join(',');
      const existing = await env.DB.prepare(
        `SELECT place_id FROM leads WHERE place_id IN (${placeholders}) AND deleted_at IS NULL`,
      ).bind(...placeIds).all<{ place_id: string }>();
      existing.results.forEach((row) => existingLeadIds.add(row.place_id));
    }

    const candidateLimit = Math.min(input.settings.maxCandidatesPerRun, remainingCapacity);
    let newCandidates = 0;
    let refreshedCandidates = 0;
    let skippedExisting = 0;
    let skippedIneligible = 0;

    for (const place of search.places) {
      if (newCandidates >= candidateLimit) break;
      if (existingLeadIds.has(place.placeId)) { skippedExisting++; continue; }
      const score = scorePlace(place);
      const ineligible = Boolean(place.website)
        || (input.settings.phoneRequired && !place.phone)
        || place.businessStatus === 'CLOSED_PERMANENTLY'
        || score.score < input.settings.scoreFloor;
      if (ineligible) { skippedIneligible++; continue; }

      const prior = await env.DB.prepare(
        'SELECT status, suppression_until FROM prospect_candidates WHERE place_id = ?',
      ).bind(place.placeId).first<{ status: string; suppression_until: string | null }>();
      if (prior?.status === 'approved') { skippedExisting++; continue; }
      if (prior?.status === 'rejected' && prior.suppression_until && Date.parse(prior.suppression_until) > Date.now()) {
        skippedIneligible++;
        continue;
      }

      await env.DB.prepare(`
        INSERT INTO prospect_candidates (
          place_id, company, phone, website, address, city, state, industry,
          search_location, google_rating, google_review_count, gbp_claimed,
          gbp_photos_count, gbp_has_hours, gbp_has_description, business_status,
          opportunity_score, recommended_tier, score_reasoning, source
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(place_id) DO UPDATE SET
          company=excluded.company, phone=excluded.phone, website=excluded.website,
          address=excluded.address, city=excluded.city, state=excluded.state,
          industry=excluded.industry, search_location=excluded.search_location,
          google_rating=excluded.google_rating, google_review_count=excluded.google_review_count,
          gbp_claimed=excluded.gbp_claimed, gbp_photos_count=excluded.gbp_photos_count,
          gbp_has_hours=excluded.gbp_has_hours, gbp_has_description=excluded.gbp_has_description,
          business_status=excluded.business_status, opportunity_score=excluded.opportunity_score,
          recommended_tier=excluded.recommended_tier, score_reasoning=excluded.score_reasoning,
          source=excluded.source, last_seen_at=datetime('now'), updated_at=datetime('now'),
          status=CASE
            WHEN prospect_candidates.status='expired' THEN 'pending'
            WHEN prospect_candidates.status='rejected' AND prospect_candidates.suppression_until <= datetime('now') THEN 'pending'
            ELSE prospect_candidates.status
          END
      `).bind(
        place.placeId, place.name, place.phone, place.website, place.address, place.city, place.state,
        input.industry, input.location, place.rating, place.reviewCount, place.claimed ? 1 : 0,
        place.photoCount, place.hasHours ? 1 : 0, place.hasDescription ? 1 : 0, place.businessStatus,
        score.score, score.tier, score.reasoning, input.triggerType === 'scheduled' ? 'automated' : 'manual',
      ).run();
      if (prior) refreshedCandidates++; else newCandidates++;
    }

    await env.DB.prepare(`
      UPDATE prospect_search_runs SET completed_at=datetime('now'), status='completed',
        results_found=?, new_candidates=?, refreshed_candidates=?, skipped_existing=?, skipped_ineligible=?
      WHERE id=?
    `).bind(search.places.length, newCandidates, refreshedCandidates, skippedExisting, skippedIneligible, runId).run();
    return {
      runId, status: 'completed', industry: input.industry, location: input.location,
      resultsFound: search.places.length, newCandidates, refreshedCandidates, skippedExisting, skippedIneligible,
    };
  } catch (error) {
    await env.DB.prepare(`
      UPDATE prospect_search_runs SET completed_at=datetime('now'), status='failed', error_message=? WHERE id=?
    `).bind((error as Error).message.slice(0, 500), runId).run();
    throw error;
  }
}

export async function approveCandidates(env: Env, candidateIds: number[]) {
  let added = 0;
  let skipped = 0;
  const errors: string[] = [];
  for (const id of candidateIds.slice(0, 25)) {
    const candidate = await env.DB.prepare(
      "SELECT * FROM prospect_candidates WHERE id = ? AND status = 'pending'",
    ).bind(id).first<Record<string, unknown>>();
    if (!candidate) { skipped++; continue; }
    try {
      const details = await getPlaceDetails(env.GOOGLE_PLACES_API_KEY, String(candidate.place_id));
      if (details.website) {
        errors.push(`${candidate.company}: now has a website`);
        skipped++;
        continue;
      }
      if (!details.phone) {
        errors.push(`${candidate.company}: no phone number`);
        skipped++;
        continue;
      }
      const dupe = await env.DB.prepare('SELECT id FROM leads WHERE place_id = ? AND deleted_at IS NULL')
        .bind(details.placeId).first<{ id: number }>();
      if (dupe) {
        await env.DB.prepare("UPDATE prospect_candidates SET status='approved', lead_id=?, approved_at=datetime('now'), updated_at=datetime('now') WHERE id=?")
          .bind(dupe.id, id).run();
        skipped++;
        continue;
      }
      const inserted = await env.DB.prepare(`
        INSERT INTO leads (
          company, phone, website, has_website, address, city, state, industry,
          place_id, gbp_claimed, gbp_photos_count, gbp_hours, google_rating,
          google_review_count, google_reviews, reviews_fetched_at, opportunity_score,
          opportunity_reasoning, recommended_tier, source, status, enrichment_status
        ) VALUES (?, ?, NULL, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?, ?, ?, 'prospect_inbox', 'cold', 'pending')
      `).bind(
        details.name, details.phone, details.address, details.city, details.state, candidate.industry,
        details.placeId, details.claimed ? 1 : 0, details.photoCount,
        details.hours ? JSON.stringify(details.hours) : null, details.rating, details.reviewCount,
        JSON.stringify(details.reviews), candidate.opportunity_score, candidate.score_reasoning,
        candidate.recommended_tier,
      ).run();
      await env.DB.prepare("UPDATE prospect_candidates SET status='approved', lead_id=?, approved_at=datetime('now'), updated_at=datetime('now') WHERE id=?")
        .bind(Number(inserted.meta.last_row_id), id).run();
      added++;
    } catch (error) {
      errors.push(`${candidate.company}: ${(error as Error).message}`);
      skipped++;
    }
  }
  return { added, skipped, errors: errors.slice(0, 10) };
}

export function discoveryCombinations(discovery: DiscoverySettings): Array<{ industry: string; location: string }> {
  return discovery.industries.flatMap((industry) => discovery.locations.map((location) => ({ industry, location })));
}

export interface NextScheduledSearch {
  enabled: boolean;
  industry: string | null;
  location: string | null;
  date: string | null; // YYYY-MM-DD in the operator's timezone
  weekday: string | null;
  localRunHour: number;
  timezone: string;
}

// Mirrors the cron's selection math (completed scheduled runs % combinations)
// so the UI shows exactly what the next run will search and when.
export function previewNextScheduledSearch(
  discovery: DiscoverySettings,
  timezone: string,
  completedScheduledRuns: number,
  now: number = Date.now(),
): NextScheduledSearch {
  const base: NextScheduledSearch = {
    enabled: discovery.enabled, industry: null, location: null,
    date: null, weekday: null, localRunHour: discovery.localRunHour, timezone,
  };
  if (!discovery.enabled) return base;
  const combinations = discoveryCombinations(discovery);
  if (!combinations.length) return base;
  const selected = combinations[completedScheduledRuns % combinations.length];
  base.industry = selected.industry;
  base.location = selected.location;
  for (let offset = 0; offset <= 7; offset++) {
    const candidate = new Date(now + offset * 86_400_000);
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone, weekday: 'long', hour: 'numeric', hourCycle: 'h23',
    }).formatToParts(candidate);
    const weekday = parts.find((part) => part.type === 'weekday')?.value.toLowerCase() ?? '';
    const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? -1);
    if (!discovery.runDays.includes(weekday)) continue;
    if (offset === 0 && hour >= discovery.localRunHour) continue;
    base.weekday = weekday;
    base.date = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(candidate);
    break;
  }
  return base;
}

export async function runScheduledDiscovery(env: Env, scheduledTime: number): Promise<DiscoveryRunResult> {
  const settings = await readSettings(env.DB);
  const discovery = settings.discovery as unknown as DiscoverySettings;
  if (!discovery.enabled) return { runId: null, status: 'skipped', reason: 'disabled', resultsFound: 0, newCandidates: 0, refreshedCandidates: 0, skippedExisting: 0, skippedIneligible: 0 };

  const localParts = new Intl.DateTimeFormat('en-US', {
    timeZone: String(settings.general.timezone || 'America/Chicago'), weekday: 'long', hour: 'numeric', hourCycle: 'h23',
  }).formatToParts(new Date(scheduledTime));
  const weekday = localParts.find((part) => part.type === 'weekday')?.value.toLowerCase() ?? '';
  const hour = Number(localParts.find((part) => part.type === 'hour')?.value ?? -1);
  if (!discovery.runDays.includes(weekday) || hour !== discovery.localRunHour) {
    return { runId: null, status: 'skipped', reason: 'not_due', resultsFound: 0, newCandidates: 0, refreshedCandidates: 0, skippedExisting: 0, skippedIneligible: 0 };
  }

  await env.DB.prepare(`
    UPDATE prospect_candidates SET status='expired', updated_at=datetime('now')
    WHERE status='pending' AND first_seen_at < datetime('now', ?)
  `).bind(`-${Math.max(1, discovery.expirationDays)} days`).run();

  const combinations = discoveryCombinations(discovery);
  if (!combinations.length) return { runId: null, status: 'skipped', reason: 'no_profiles', resultsFound: 0, newCandidates: 0, refreshedCandidates: 0, skippedExisting: 0, skippedIneligible: 0 };
  const completed = await env.DB.prepare("SELECT COUNT(*) AS n FROM prospect_search_runs WHERE trigger_type='scheduled' AND status='completed'")
    .first<{ n: number }>();
  const selected = combinations[Number(completed?.n ?? 0) % combinations.length];
  const dayKey = new Intl.DateTimeFormat('en-CA', { timeZone: String(settings.general.timezone || 'America/Chicago'), year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(scheduledTime));
  return discoverCandidates(env, {
    ...selected, triggerType: 'scheduled', settings: discovery,
    scheduledKey: `scheduled:${dayKey}`,
  });
}
