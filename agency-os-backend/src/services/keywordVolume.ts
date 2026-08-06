/**
 * Keyword volume provider interface. Callers (routes/research.ts, the
 * monthly cron) never import a concrete provider — selection happens here
 * via the KEYWORD_VOLUME_PROVIDER var so the vendor can be swapped without
 * touching call sites.
 *
 * Every number attached to a keyword comes from the provider API. A
 * model-generated volume figure is a defect.
 */

import type { Env } from '../types';
import { generateKeywordIdeas, type KeywordIdeaMetrics } from './googleAds';

export interface KeywordVolumeRow {
  keyword: string;
  monthlyVolume: number | null;
  competition: string | null;          // LOW | MEDIUM | HIGH
  competitionIndex: number | null;     // 0–100
  cpcLow: number | null;               // dollars
  cpcHigh: number | null;              // dollars
  /** 12-month seasonality, oldest first. */
  trend: Array<{ year: number; month: number; volume: number }>;
}

export interface KeywordVolumeProvider {
  name: 'google_ads' | 'dataforseo';
  fetchVolumes(keywords: string[], geoTargetId: string): Promise<KeywordVolumeRow[]>;
}

const MICROS_PER_DOLLAR = 1_000_000;

function fromIdeaMetrics(idea: KeywordIdeaMetrics): KeywordVolumeRow {
  return {
    keyword: idea.keyword,
    monthlyVolume: idea.avgMonthlySearches,
    competition: idea.competition,
    competitionIndex: idea.competitionIndex,
    cpcLow: idea.lowTopOfPageBidMicros !== null ? idea.lowTopOfPageBidMicros / MICROS_PER_DOLLAR : null,
    cpcHigh: idea.highTopOfPageBidMicros !== null ? idea.highTopOfPageBidMicros / MICROS_PER_DOLLAR : null,
    trend: idea.monthlySearchVolumes
      .slice()
      .sort((a, b) => (a.year - b.year) || (a.month - b.month))
      .map((v) => ({ year: v.year, month: v.month, volume: v.monthlySearches })),
  };
}

function googleAdsProvider(env: Env): KeywordVolumeProvider {
  return {
    name: 'google_ads',
    async fetchVolumes(keywords, geoTargetId) {
      const ideas = await generateKeywordIdeas(env, keywords, geoTargetId);
      return ideas.map(fromIdeaMetrics);
    },
  };
}

/**
 * Resolve the active provider. Defaults to Google Ads; a DataForSEO
 * implementation slots in here when/if it exists — callers stay unchanged.
 */
export function getKeywordVolumeProvider(env: Env): KeywordVolumeProvider {
  const selected = (env.KEYWORD_VOLUME_PROVIDER ?? 'google_ads').trim();
  if (selected === 'dataforseo') {
    throw new Error('KEYWORD_VOLUME_PROVIDER=dataforseo is selected but the DataForSEO provider is not implemented yet');
  }
  return googleAdsProvider(env);
}
