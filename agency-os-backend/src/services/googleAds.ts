/**
 * Google Ads API — keyword volume via KeywordPlanIdeaService.GenerateKeywordIdeas.
 *
 * REST only; the official Google client libraries are Node-targeted and
 * hostile to Workers. Auth mirrors services/gsc.ts: OAuth refresh-token
 * exchange with an in-memory access-token cache, plus the two Ads-specific
 * headers (`developer-token`, `login-customer-id`).
 *
 * Until the developer token is approved for Basic Access (applied for with
 * keyword research as the use case), requests against real accounts fail
 * with DEVELOPER_TOKEN_NOT_APPROVED — surfaced distinctly so the Settings
 * health card can tell "approval pending" apart from a bad credential.
 */

import { log } from '../utils/errors';
import type { Env } from '../types';

// Google moved to a monthly release cadence with ~1 year of support per
// major version and abrupt sunsets — a retired version fails with no grace
// period. Bumping this constant must be the ONLY change needed.
export const GOOGLE_ADS_API_VERSION = 'v21';

let cachedToken: { token: string; expiresAt: number } | null = null;

async function getAccessToken(clientId: string, clientSecret: string, refreshToken: string): Promise<string> {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt > now) return cachedToken.token;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    log('error', 'googleAds', `Token exchange failed: ${res.status}`, { err: err.slice(0, 200) });
    throw new Error(`Google Ads OAuth token exchange failed: ${res.status}`);
  }

  const data = await res.json() as { access_token: string; expires_in: number };
  cachedToken = { token: data.access_token, expiresAt: now + 55 * 60 * 1000 };
  log('info', 'googleAds', 'OAuth access token refreshed');
  return data.access_token;
}

export interface KeywordIdeaMetrics {
  keyword: string;
  avgMonthlySearches: number | null;
  monthlySearchVolumes: Array<{ year: number; month: number; monthlySearches: number }>;
  competition: string | null;          // LOW | MEDIUM | HIGH
  competitionIndex: number | null;     // 0–100
  lowTopOfPageBidMicros: number | null;
  highTopOfPageBidMicros: number | null;
}

/** Thrown when the token is valid but not yet approved for Basic Access. */
export class AdsAccessPendingError extends Error {
  constructor(detail: string) {
    super(`Google Ads developer token not yet approved for Basic Access: ${detail}`);
    this.name = 'AdsAccessPendingError';
  }
}

interface RawIdeaResult {
  text?: string;
  keywordIdeaMetrics?: {
    avgMonthlySearches?: string | number;
    competition?: string;
    competitionIndex?: string | number;
    lowTopOfPageBidMicros?: string | number;
    highTopOfPageBidMicros?: string | number;
    monthlySearchVolumes?: Array<{ year?: string | number; month?: string; monthlySearches?: string | number }>;
  };
}

// The REST API serializes int64 as strings and months as enum names.
const MONTH_NUMBERS: Record<string, number> = {
  JANUARY: 1, FEBRUARY: 2, MARCH: 3, APRIL: 4, MAY: 5, JUNE: 6,
  JULY: 7, AUGUST: 8, SEPTEMBER: 9, OCTOBER: 10, NOVEMBER: 11, DECEMBER: 12,
};

function toNumber(value: string | number | undefined): number | null {
  if (value === undefined || value === null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * One call covers up to 1,000 seed keywords — an entire market's expansion.
 * `geoTargetId` is the Google Ads city criteria ID stored on the market row.
 */
export async function generateKeywordIdeas(
  env: Env,
  keywords: string[],
  geoTargetId: string,
): Promise<KeywordIdeaMetrics[]> {
  const clientId = env.GOOGLE_ADS_CLIENT_ID;
  const clientSecret = env.GOOGLE_ADS_CLIENT_SECRET;
  const refreshToken = env.GOOGLE_ADS_REFRESH_TOKEN;
  const developerToken = env.GOOGLE_ADS_DEVELOPER_TOKEN;
  const loginCustomerId = (env.GOOGLE_ADS_LOGIN_CUSTOMER_ID ?? '').replace(/-/g, '');
  if (!clientId || !clientSecret || !refreshToken || !developerToken || !loginCustomerId) {
    throw new Error('Google Ads is not configured — missing one or more of GOOGLE_ADS_DEVELOPER_TOKEN, GOOGLE_ADS_CLIENT_ID, GOOGLE_ADS_CLIENT_SECRET, GOOGLE_ADS_REFRESH_TOKEN, GOOGLE_ADS_LOGIN_CUSTOMER_ID');
  }
  // Planning services address a client account; default to the MCC id and
  // allow an explicit override for setups where Google rejects manager-level
  // planning calls.
  const customerId = (env.GOOGLE_ADS_CUSTOMER_ID ?? loginCustomerId).replace(/-/g, '');

  const token = await getAccessToken(clientId, clientSecret, refreshToken);
  const res = await fetch(
    `https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}/customers/${customerId}:generateKeywordIdeas`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'developer-token': developerToken,
        'login-customer-id': loginCustomerId,
      },
      body: JSON.stringify({
        geoTargetConstants: [`geoTargetConstants/${geoTargetId}`],
        language: 'languageConstants/1000', // English
        keywordPlanNetwork: 'GOOGLE_SEARCH',
        includeAdultKeywords: false,
        keywordSeed: { keywords: keywords.slice(0, 1000) },
        // Historical metrics for the seeds themselves are what we chart;
        // Google also returns close variants which we keep for context.
        pageSize: 1000,
      }),
    },
  );

  if (!res.ok) {
    const errText = await res.text();
    log('error', 'googleAds', `generateKeywordIdeas failed: ${res.status}`, { err: errText.slice(0, 400) });
    if (errText.includes('DEVELOPER_TOKEN_NOT_APPROVED') || errText.includes('NOT_ADS_USER')) {
      throw new AdsAccessPendingError(errText.slice(0, 200));
    }
    throw new Error(`Google Ads generateKeywordIdeas failed: ${res.status}`);
  }

  const data = await res.json() as { results?: RawIdeaResult[] };
  return (data.results ?? [])
    .filter((r): r is RawIdeaResult & { text: string } => typeof r.text === 'string' && r.text.length > 0)
    .map((r) => {
      const m = r.keywordIdeaMetrics;
      return {
        keyword: r.text,
        avgMonthlySearches: toNumber(m?.avgMonthlySearches),
        monthlySearchVolumes: (m?.monthlySearchVolumes ?? []).map((v) => ({
          year: toNumber(v.year) ?? 0,
          month: MONTH_NUMBERS[v.month ?? ''] ?? 0,
          monthlySearches: toNumber(v.monthlySearches) ?? 0,
        })).filter((v) => v.year > 0 && v.month > 0),
        competition: m?.competition ?? null,
        competitionIndex: toNumber(m?.competitionIndex),
        lowTopOfPageBidMicros: toNumber(m?.lowTopOfPageBidMicros),
        highTopOfPageBidMicros: toNumber(m?.highTopOfPageBidMicros),
      };
    });
}

/** True when every required Google Ads credential is present. */
export function isGoogleAdsConfigured(env: Env): boolean {
  return Boolean(
    env.GOOGLE_ADS_DEVELOPER_TOKEN?.trim()
    && env.GOOGLE_ADS_CLIENT_ID?.trim()
    && env.GOOGLE_ADS_CLIENT_SECRET?.trim()
    && env.GOOGLE_ADS_REFRESH_TOKEN?.trim()
    && env.GOOGLE_ADS_LOGIN_CUSTOMER_ID?.trim(),
  );
}
