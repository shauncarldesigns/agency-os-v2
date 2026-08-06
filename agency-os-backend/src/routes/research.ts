/**
 * Market Research — demand data per industry × location market.
 *
 * A market is one industry × location pair. Demand is a property of the
 * MARKET, never a lead: every plumber in Green Bay shares the volume for
 * "plumber near me", so one provider call covers an entire industry's
 * pipeline in a city.
 *
 * Subrequest budget per market: 1 volume call (covers up to 1,000 keywords)
 * + N map pack scrapes × ~15 polls ≈ 50 subrequests at the default N=3.
 * A run across markets caps at the configured batch limit (default 15) and
 * stops cleanly with `stoppedEarly` when the Worker cap is exhausted,
 * matching the enrich-all pattern.
 */

import { Hono } from 'hono';
import type { Env } from '../types';
import { log, serverError } from '../utils/errors';
import { getKeywordVolumeProvider, type KeywordVolumeRow } from '../services/keywordVolume';
import { AdsAccessPendingError } from '../services/googleAds';
import { captureMapPack } from '../services/mapPack';
import { geocodeCity } from '../services/places';
import { readSettings } from './settings';

export const researchRouter = new Hono<{ Bindings: Env }>();

export interface MarketRow {
  id: number;
  industry: string;
  location_label: string;
  geo_target_id: string;
  latitude: number;
  longitude: number;
  is_active: number;
  last_researched_at: string | null;
  created_at: string;
}

interface ResearchConfig {
  seedTemplates: string[];
  industryTerms: Record<string, string>;
  mapPackKeywordCount: number;
  mapPackResultLimit: number;
  batchCap: number;
  provider: string;
}

function researchConfig(settings: Awaited<ReturnType<typeof readSettings>>): ResearchConfig {
  return settings.research as ResearchConfig;
}

/**
 * Expand the industry's seed templates against a market's city. Claude is
 * allowed to propose keyword *phrasings* in future phases; every number
 * attached to them must come from the provider API.
 */
export function expandSeeds(config: ResearchConfig, industry: string, locationLabel: string): Array<{ keyword: string; isNearMe: boolean }> {
  const service = (config.industryTerms[industry] ?? industry).toLowerCase().trim();
  // 'Green Bay, WI' → 'green bay'
  const city = locationLabel.split(',')[0]?.toLowerCase().trim() ?? locationLabel.toLowerCase().trim();
  const seen = new Set<string>();
  const out: Array<{ keyword: string; isNearMe: boolean }> = [];
  for (const template of config.seedTemplates) {
    const keyword = template
      .replaceAll('{service}', service)
      .replaceAll('{city}', city)
      .replace(/\s+/g, ' ')
      .trim();
    if (!keyword || seen.has(keyword)) continue;
    seen.add(keyword);
    out.push({ keyword, isNearMe: keyword.includes('near me') });
  }
  return out;
}

interface RunSummary {
  runId: number;
  marketId: number;
  status: 'complete' | 'partial' | 'failed';
  keywordsStored: number;
  mapPackKeywords: string[];
  mapPackRowsStored: number;
  errorDetail: string | null;
}

/**
 * Execute one market's research: volume fetch → keyword upsert → map pack
 * capture on the top near-me terms. Subrequest-cap errors propagate so the
 * batch caller can stop; every other failure is recorded on the run row.
 */
export async function runMarketResearch(
  env: Env,
  market: MarketRow,
  trigger: 'manual' | 'scheduled',
): Promise<RunSummary> {
  const settings = await readSettings(env.DB);
  const config = researchConfig(settings);
  const provider = getKeywordVolumeProvider(env);

  const runInsert = await env.DB.prepare(
    'INSERT INTO research_runs (market_id, "trigger", provider) VALUES (?, ?, ?) RETURNING id',
  ).bind(market.id, trigger, provider.name).first<{ id: number }>();
  const runId = runInsert!.id;

  const fail = async (detail: string, status: 'failed' | 'partial', stored = 0, mapKeywords: string[] = [], mapRows = 0): Promise<RunSummary> => {
    await env.DB.prepare(
      "UPDATE research_runs SET status = ?, error_detail = ?, keywords_count = ?, completed_at = datetime('now') WHERE id = ?",
    ).bind(status, detail.slice(0, 500), stored, runId).run();
    return { runId, marketId: market.id, status, keywordsStored: stored, mapPackKeywords: mapKeywords, mapPackRowsStored: mapRows, errorDetail: detail };
  };

  // 1. Volume — one provider call for the full seed expansion.
  const seeds = expandSeeds(config, market.industry, market.location_label);
  const nearMeSeedKeywords = new Set(seeds.filter(s => s.isNearMe).map(s => s.keyword));
  let volumes: KeywordVolumeRow[];
  try {
    volumes = await provider.fetchVolumes(seeds.map(s => s.keyword), market.geo_target_id);
  } catch (err) {
    const msg = (err as Error).message;
    if (msg.includes('Too many subrequests')) {
      await fail(msg, 'failed');
      throw err; // let the batch caller stop cleanly
    }
    log('error', 'research', `Volume fetch failed for market ${market.id}`, { msg });
    return fail(err instanceof AdsAccessPendingError ? msg : `Keyword volume fetch failed: ${msg}`, 'failed');
  }

  // 2. Upsert keywords on (market_id, keyword) so history doesn't balloon.
  let stored = 0;
  for (const row of volumes) {
    await env.DB.prepare(`
      INSERT INTO market_keywords (market_id, run_id, keyword, monthly_volume, competition, competition_index, cpc_low, cpc_high, trend_json, is_near_me, fetched_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(market_id, keyword) DO UPDATE SET
        run_id = excluded.run_id,
        monthly_volume = excluded.monthly_volume,
        competition = excluded.competition,
        competition_index = excluded.competition_index,
        cpc_low = excluded.cpc_low,
        cpc_high = excluded.cpc_high,
        trend_json = excluded.trend_json,
        is_near_me = excluded.is_near_me,
        fetched_at = datetime('now')
    `).bind(
      market.id, runId, row.keyword, row.monthlyVolume, row.competition,
      row.competitionIndex, row.cpcLow, row.cpcHigh,
      row.trend.length ? JSON.stringify(row.trend) : null,
      row.keyword.includes('near me') || nearMeSeedKeywords.has(row.keyword) ? 1 : 0,
    ).run();
    stored++;
  }

  // 3. Map pack on the top N money terms only — near-me variants first
  // (map pack rank via GBP is the only position a no-website business has),
  // padded with the highest-volume head terms if fewer near-me terms exist.
  const byVolume = volumes.slice().sort((a, b) => (b.monthlyVolume ?? 0) - (a.monthlyVolume ?? 0));
  const nearMe = byVolume.filter(v => v.keyword.includes('near me') || nearMeSeedKeywords.has(v.keyword));
  const rest = byVolume.filter(v => !nearMe.includes(v));
  const targets = [...nearMe, ...rest].slice(0, Math.max(1, config.mapPackKeywordCount)).map(v => v.keyword);

  const apiKey = env.OUTSCRAPER_API_KEY;
  let mapRows = 0;
  const mapErrors: string[] = [];
  if (!apiKey?.trim()) {
    mapErrors.push('OUTSCRAPER_API_KEY is not configured — map pack capture skipped');
  } else {
    for (const keyword of targets) {
      try {
        // Explicit coordinates on every scrape — an unlocated "near me"
        // scrape ranks businesses around the scraper's IP, not the market.
        const entries = await captureMapPack(apiKey, keyword, market.latitude, market.longitude, config.mapPackResultLimit);
        for (const entry of entries) {
          await env.DB.prepare(`
            INSERT INTO map_pack_results (market_id, run_id, keyword, position, place_id, company, has_website, website, google_rating, review_count)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).bind(
            market.id, runId, keyword, entry.position, entry.placeId, entry.company,
            entry.hasWebsite ? 1 : 0, entry.website, entry.googleRating, entry.reviewCount,
          ).run();
          mapRows++;
        }
      } catch (err) {
        const msg = (err as Error).message;
        if (msg.includes('Too many subrequests')) {
          await fail(msg, 'partial', stored, targets, mapRows);
          throw err; // keywords are stored; batch caller stops cleanly
        }
        log('warn', 'research', `Map pack capture failed for "${keyword}"`, { marketId: market.id, msg });
        mapErrors.push(`"${keyword}": ${msg}`);
      }
    }
  }

  const status = mapErrors.length ? 'partial' : 'complete';
  await env.DB.prepare(
    "UPDATE research_runs SET status = ?, keywords_count = ?, error_detail = ?, completed_at = datetime('now') WHERE id = ?",
  ).bind(status, stored, mapErrors.length ? mapErrors.join(' · ').slice(0, 500) : null, runId).run();
  await env.DB.prepare(
    "UPDATE markets SET last_researched_at = datetime('now') WHERE id = ?",
  ).bind(market.id).run();

  return {
    runId, marketId: market.id, status, keywordsStored: stored,
    mapPackKeywords: targets, mapPackRowsStored: mapRows,
    errorDetail: mapErrors.length ? mapErrors.join(' · ') : null,
  };
}

/**
 * Batch across active markets, oldest research first, capped at the
 * configured batch limit. Used by POST /run-all and the monthly refresh.
 */
export async function runAllMarketResearch(env: Env, trigger: 'manual' | 'scheduled') {
  const settings = await readSettings(env.DB);
  const config = researchConfig(settings);
  const markets = await env.DB.prepare(`
    SELECT * FROM markets WHERE is_active = 1
    ORDER BY last_researched_at ASC NULLS FIRST, id ASC
    LIMIT ?
  `).bind(Math.max(1, config.batchCap)).all<MarketRow>();

  const runs: RunSummary[] = [];
  let stoppedEarly: string | null = null;
  for (const market of markets.results) {
    try {
      runs.push(await runMarketResearch(env, market, trigger));
    } catch (err) {
      const msg = (err as Error).message;
      if (msg.includes('Too many subrequests')) {
        stoppedEarly = 'subrequest_budget_exhausted';
        break;
      }
      log('error', 'research', `Research failed for market ${market.id}`, { msg });
    }
  }
  return {
    processed: runs.length,
    runs,
    stoppedEarly,
    remainingUnprocessed: stoppedEarly ? markets.results.length - runs.length : 0,
  };
}

// ---------------------------------------------------------------------------
// Routes (mounted at /api/research)
// ---------------------------------------------------------------------------

researchRouter.get('/markets', async (c) => {
  try {
    const markets = await c.env.DB.prepare(`
      SELECT m.*,
        (SELECT k.keyword FROM market_keywords k WHERE k.market_id = m.id AND k.is_near_me = 1
          ORDER BY k.monthly_volume DESC LIMIT 1) AS headline_keyword,
        (SELECT k.monthly_volume FROM market_keywords k WHERE k.market_id = m.id AND k.is_near_me = 1
          ORDER BY k.monthly_volume DESC LIMIT 1) AS headline_volume,
        (SELECT COUNT(*) FROM market_keywords k WHERE k.market_id = m.id) AS keyword_count,
        (SELECT r.status FROM research_runs r WHERE r.market_id = m.id
          ORDER BY r.started_at DESC, r.id DESC LIMIT 1) AS last_run_status
      FROM markets m
      ORDER BY m.is_active DESC, m.industry ASC, m.location_label ASC
    `).all();
    return c.json({ markets: markets.results });
  } catch (err) {
    log('error', 'research', 'GET /markets failed', err);
    return c.json(serverError(), 500);
  }
});

// City typeahead for the add-market form, backed by the seeded geo_targets
// table (Google's geotargets CSV) — the operator picks a name; the criteria
// ID rides along invisibly.
researchRouter.get('/geo-targets', async (c) => {
  try {
    const q = (c.req.query('q') ?? '').trim();
    if (q.length < 2) return c.json({ targets: [] });
    const targets = await c.env.DB.prepare(`
      SELECT criteria_id, name, canonical_name, state FROM geo_targets
      WHERE name LIKE ? ORDER BY name ASC LIMIT 12
    `).bind(`${q}%`).all();
    return c.json({ targets: targets.results });
  } catch (err) {
    log('error', 'research', 'GET /geo-targets failed', err);
    return c.json(serverError(), 500);
  }
});

researchRouter.post('/markets', async (c) => {
  try {
    const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
    const industry = typeof body.industry === 'string' ? body.industry.trim() : '';
    const geoTargetId = typeof body.geo_target_id === 'string' ? body.geo_target_id.trim() : String(body.geo_target_id ?? '').trim();
    if (!industry) return c.json({ error: 'Industry is required' }, 400);
    if (!/^\d+$/.test(geoTargetId)) return c.json({ error: 'Pick a city from the list' }, 400);

    const geo = await c.env.DB.prepare(
      'SELECT criteria_id, name, state FROM geo_targets WHERE criteria_id = ?',
    ).bind(geoTargetId).first<{ criteria_id: string; name: string; state: string }>();

    // Label comes from the seeded lookup when the ID is known; explicit
    // label/coords in the body remain honored for API callers and any
    // future non-seeded geography.
    const locationLabel = geo
      ? `${geo.name}, ${geo.state}`
      : (typeof body.location_label === 'string' ? body.location_label.trim() : '');
    if (!locationLabel) return c.json({ error: 'Unknown geo target — pick a city from the list' }, 400);

    let latitude = Number(body.latitude);
    let longitude = Number(body.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      // Resolve city-center coordinates automatically — the operator never
      // types them. Approximate center is fine for map pack anchoring.
      const coords = await geocodeCity(c.env.GOOGLE_PLACES_API_KEY, locationLabel);
      if (!coords) return c.json({ error: `Could not resolve coordinates for ${locationLabel}` }, 502);
      latitude = coords.lat;
      longitude = coords.lng;
    }
    if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
      return c.json({ error: 'Coordinates out of range' }, 400);
    }

    const existing = await c.env.DB.prepare(
      'SELECT id FROM markets WHERE industry = ? AND geo_target_id = ?',
    ).bind(industry, geoTargetId).first();
    if (existing) return c.json({ error: 'That industry × location market already exists' }, 409);

    const market = await c.env.DB.prepare(`
      INSERT INTO markets (industry, location_label, geo_target_id, latitude, longitude)
      VALUES (?, ?, ?, ?, ?) RETURNING *
    `).bind(industry, locationLabel, geoTargetId, latitude, longitude).first<MarketRow>();
    return c.json({ market }, 201);
  } catch (err) {
    log('error', 'research', 'POST /markets failed', err);
    const msg = (err as Error).message;
    if (msg.includes('geocoding') || msg.includes('Google Places')) {
      return c.json({ error: msg }, 502);
    }
    return c.json(serverError(), 500);
  }
});

researchRouter.patch('/markets/:id', async (c) => {
  try {
    const id = Number(c.req.param('id'));
    const market = await c.env.DB.prepare('SELECT * FROM markets WHERE id = ?').bind(id).first<MarketRow>();
    if (!market) return c.json({ error: 'Market not found' }, 404);
    const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;

    const isActive = body.is_active !== undefined ? (body.is_active ? 1 : 0) : market.is_active;
    const locationLabel = typeof body.location_label === 'string' && body.location_label.trim() ? body.location_label.trim() : market.location_label;
    const geoTargetId = body.geo_target_id !== undefined ? String(body.geo_target_id).trim() : market.geo_target_id;
    const latitude = body.latitude !== undefined ? Number(body.latitude) : market.latitude;
    const longitude = body.longitude !== undefined ? Number(body.longitude) : market.longitude;
    if (!/^\d+$/.test(geoTargetId)) return c.json({ error: 'Geo target must be a numeric Google Ads city criteria ID' }, 400);
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) return c.json({ error: 'Latitude must be between -90 and 90' }, 400);
    if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) return c.json({ error: 'Longitude must be between -180 and 180' }, 400);

    const updated = await c.env.DB.prepare(`
      UPDATE markets SET is_active = ?, location_label = ?, geo_target_id = ?, latitude = ?, longitude = ?
      WHERE id = ? RETURNING *
    `).bind(isActive, locationLabel, geoTargetId, latitude, longitude, id).first<MarketRow>();
    return c.json({ market: updated });
  } catch (err) {
    log('error', 'research', 'PATCH /markets/:id failed', err);
    return c.json(serverError(), 500);
  }
});

researchRouter.delete('/markets/:id', async (c) => {
  try {
    const id = Number(c.req.param('id'));
    const result = await c.env.DB.prepare('DELETE FROM markets WHERE id = ?').bind(id).run();
    if (!result.meta.changes) return c.json({ error: 'Market not found' }, 404);
    return c.json({ deleted: true });
  } catch (err) {
    log('error', 'research', 'DELETE /markets/:id failed', err);
    return c.json(serverError(), 500);
  }
});

researchRouter.get('/markets/:id', async (c) => {
  try {
    const id = Number(c.req.param('id'));
    const market = await c.env.DB.prepare('SELECT * FROM markets WHERE id = ?').bind(id).first<MarketRow>();
    if (!market) return c.json({ error: 'Market not found' }, 404);

    const [keywords, runs, latestCaptures] = await Promise.all([
      c.env.DB.prepare(
        'SELECT * FROM market_keywords WHERE market_id = ? ORDER BY monthly_volume DESC NULLS LAST, keyword ASC',
      ).bind(id).all(),
      c.env.DB.prepare(
        'SELECT * FROM research_runs WHERE market_id = ? ORDER BY started_at DESC, id DESC LIMIT 20',
      ).bind(id).all(),
      // Latest capture per keyword: map pack history is append-only, so the
      // display always uses each keyword's most recent run.
      c.env.DB.prepare(`
        SELECT keyword, MAX(run_id) AS run_id FROM map_pack_results
        WHERE market_id = ? GROUP BY keyword
      `).bind(id).all<{ keyword: string; run_id: number }>(),
    ]);

    const mapPack: Record<string, unknown[]> = {};
    for (const capture of latestCaptures.results) {
      const rows = await c.env.DB.prepare(
        'SELECT * FROM map_pack_results WHERE market_id = ? AND keyword = ? AND run_id IS ? ORDER BY position ASC',
      ).bind(id, capture.keyword, capture.run_id).all();
      mapPack[capture.keyword] = rows.results;
    }

    return c.json({ market, keywords: keywords.results, mapPack, runs: runs.results });
  } catch (err) {
    log('error', 'research', 'GET /markets/:id failed', err);
    return c.json(serverError(), 500);
  }
});

researchRouter.post('/markets/:id/research', async (c) => {
  try {
    const id = Number(c.req.param('id'));
    const market = await c.env.DB.prepare('SELECT * FROM markets WHERE id = ?').bind(id).first<MarketRow>();
    if (!market) return c.json({ error: 'Market not found' }, 404);
    try {
      const run = await runMarketResearch(c.env, market, 'manual');
      return c.json({ run, stoppedEarly: null });
    } catch (err) {
      const msg = (err as Error).message;
      if (msg.includes('Too many subrequests')) {
        return c.json({ run: null, stoppedEarly: 'subrequest_budget_exhausted', error: msg }, 200);
      }
      throw err;
    }
  } catch (err) {
    log('error', 'research', 'POST /markets/:id/research failed', err);
    return c.json(serverError(), 500);
  }
});

researchRouter.post('/run-all', async (c) => {
  try {
    return c.json(await runAllMarketResearch(c.env, 'manual'));
  } catch (err) {
    log('error', 'research', 'POST /run-all failed', err);
    return c.json(serverError(), 500);
  }
});

researchRouter.get('/keyword-seeds/:industry', async (c) => {
  try {
    const settings = await readSettings(c.env.DB);
    const config = researchConfig(settings);
    const industry = c.req.param('industry');
    const templates = config.seedTemplates;
    const serviceTerm = config.industryTerms[industry] ?? industry;
    // Preview against a placeholder city so the operator sees real phrasing.
    const preview = expandSeeds(config, industry, '{city}');
    return c.json({ industry, serviceTerm, templates, preview: preview.map(p => p.keyword) });
  } catch (err) {
    log('error', 'research', 'GET /keyword-seeds/:industry failed', err);
    return c.json(serverError(), 500);
  }
});
