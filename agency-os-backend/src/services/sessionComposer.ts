// Session composition recipe + industry rotation.
//
// Rules (see calling-dashboard spec §4):
// - One industry per day, both blocks (morning + evening keep the script
//   consistent).
// - Auto-rotate across industries in fixed order, resuming from last week's
//   stopping point (persisted in weekly_rotation single-row table).
// - 40 leads per block, ordered by opportunity_score DESC.
// - Filter: enrichment_status='enriched', status IN ('cold','contacted'),
//   recommended_tier NOT NULL, last_called_at < now-14d OR null,
//   industry matches, score >= floor, optional geographic_filter.
//
// Extend +20 widening cascade (per baked-in defaults):
//   1. Drop score_floor by 10 (down to 30 min)
//   2. Drop geographic_filter
//   3. Drop 14-day last_called exclusion (last resort)

import type { Env, Lead } from '../types';

// Fixed rotation order. If the operator wants a different industry, they
// override per session via the Edit modal in the Monday view (Phase 7).
// New industries can be added here; rotation will pick them up automatically.
export const INDUSTRY_ROTATION = [
  'Plumbing',
  'HVAC',
  'Electrical',
  'Roofing',
  'General Contracting',
] as const;

export type Industry = typeof INDUSTRY_ROTATION[number];

// Pick the next industry given the last one served. Wraps around the array.
// If lastIndustry is null/unknown, start from the first.
export function nextIndustry(lastIndustry: string | null): Industry {
  if (!lastIndustry) return INDUSTRY_ROTATION[0];
  const idx = (INDUSTRY_ROTATION as readonly string[]).indexOf(lastIndustry);
  if (idx < 0) return INDUSTRY_ROTATION[0];
  return INDUSTRY_ROTATION[(idx + 1) % INDUSTRY_ROTATION.length];
}

export interface CompositionFilter {
  industry: string;
  scoreFloor: number;
  geographicFilter: string[] | null;     // null = no city filter
  excludeRecentlyCalled: boolean;        // false = widening step 3
  excludeLeadIds: number[];              // already in another session this week
  limit: number;
}

export interface CompositionResult {
  leads: Lead[];
  appliedFilter: CompositionFilter;
  widened: WideningStep[];
}

export type WideningStep =
  | { step: 'drop_score_floor'; from: number; to: number }
  | { step: 'drop_geographic_filter'; from: string[] }
  | { step: 'drop_recent_call_exclusion' };

// Run a single composition query. No widening — callers do widening via the
// composeWithWidening helper below.
export async function composeLeads(
  env: Env,
  filter: CompositionFilter
): Promise<Lead[]> {
  const clauses = [
    `enrichment_status = 'enriched'`,
    `status IN ('cold', 'contacted')`,
    `recommended_tier IS NOT NULL`,
    `deleted_at IS NULL`,
    `industry = ?`,
    `(opportunity_score IS NULL OR opportunity_score >= ?)`,
  ];
  const params: unknown[] = [filter.industry, filter.scoreFloor];

  if (filter.excludeRecentlyCalled) {
    clauses.push(`(last_called_at IS NULL OR last_called_at < datetime('now', '-14 days'))`);
  }

  if (filter.geographicFilter && filter.geographicFilter.length > 0) {
    const placeholders = filter.geographicFilter.map(() => '?').join(',');
    clauses.push(`city IN (${placeholders})`);
    params.push(...filter.geographicFilter);
  }

  if (filter.excludeLeadIds.length > 0) {
    const placeholders = filter.excludeLeadIds.map(() => '?').join(',');
    clauses.push(`id NOT IN (${placeholders})`);
    params.push(...filter.excludeLeadIds);
  }

  // ORDER BY opportunity_score DESC NULLS LAST, last_called_at NULLS FIRST.
  // Highest-score leads first; among those, never-called > stale calls.
  const sql = `
    SELECT * FROM leads
    WHERE ${clauses.join(' AND ')}
    ORDER BY opportunity_score DESC, last_called_at ASC NULLS FIRST
    LIMIT ?
  `;
  params.push(filter.limit);

  const result = await env.DB.prepare(sql).bind(...params).all<Lead>();
  return (result.results ?? []) as Lead[];
}

// Compose with the widening cascade applied. Returns up to `target` leads,
// applying widening steps in order if the strict filter doesn't fill.
export async function composeWithWidening(
  env: Env,
  baseFilter: CompositionFilter,
  target: number
): Promise<CompositionResult> {
  const widened: WideningStep[] = [];
  let current = { ...baseFilter, limit: target };
  let leads = await composeLeads(env, current);
  if (leads.length >= target) {
    return { leads, appliedFilter: current, widened };
  }

  // Step 1: drop score floor in 10-point increments down to 30.
  while (leads.length < target && current.scoreFloor > 30) {
    const newFloor = Math.max(30, current.scoreFloor - 10);
    widened.push({ step: 'drop_score_floor', from: current.scoreFloor, to: newFloor });
    current = { ...current, scoreFloor: newFloor };
    leads = await composeLeads(env, current);
  }
  if (leads.length >= target) return { leads, appliedFilter: current, widened };

  // Step 2: drop geographic filter.
  if (current.geographicFilter && current.geographicFilter.length > 0) {
    widened.push({ step: 'drop_geographic_filter', from: current.geographicFilter });
    current = { ...current, geographicFilter: null };
    leads = await composeLeads(env, current);
  }
  if (leads.length >= target) return { leads, appliedFilter: current, widened };

  // Step 3: last resort — drop the 14-day exclusion.
  if (current.excludeRecentlyCalled) {
    widened.push({ step: 'drop_recent_call_exclusion' });
    current = { ...current, excludeRecentlyCalled: false };
    leads = await composeLeads(env, current);
  }

  return { leads, appliedFilter: current, widened };
}
