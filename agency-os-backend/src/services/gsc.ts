// Google Search Console — OAuth refresh token flow + searchanalytics queries.
// Lifted from v1 with no behavior change.
import { log } from '../utils/errors';

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
    log('error', 'gsc', `Token exchange failed: ${res.status}`, { err: err.slice(0, 200) });
    throw new Error(`GSC OAuth token exchange failed: ${res.status}`);
  }

  const data = await res.json() as { access_token: string; expires_in: number };
  cachedToken = { token: data.access_token, expiresAt: now + 55 * 60 * 1000 };
  log('info', 'gsc', 'OAuth access token refreshed');
  return data.access_token;
}

export interface GscRow {
  query: string;
  page: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export interface GscQueryResult {
  impressions: number;
  clicks: number;
  avgPosition: number;
  ctr: number;
  rows: GscRow[];
}

export async function querySearchAnalytics(
  clientId: string,
  clientSecret: string,
  refreshToken: string,
  siteUrl: string,
  startDate: string,
  endDate: string
): Promise<GscQueryResult> {
  const token = await getAccessToken(clientId, clientSecret, refreshToken);
  const encodedUrl = encodeURIComponent(siteUrl);

  const res = await fetch(
    `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodedUrl}/searchanalytics/query`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        startDate,
        endDate,
        dimensions: ['query', 'page'],
        rowLimit: 100,
        type: 'web',
      }),
    }
  );

  if (!res.ok) {
    const err = await res.text();
    log('error', 'gsc', `Search analytics query failed: ${res.status}`, { err: err.slice(0, 200) });
    throw new Error(`GSC query failed: ${res.status}`);
  }

  const data = await res.json() as {
    rows?: Array<{ keys: string[]; clicks: number; impressions: number; ctr: number; position: number }>;
  };

  const rows: GscRow[] = (data.rows ?? []).map(r => ({
    query: r.keys[0] ?? '',
    page: r.keys[1] ?? '',
    clicks: r.clicks,
    impressions: r.impressions,
    ctr: r.ctr,
    position: r.position,
  }));

  const totals = rows.reduce(
    (acc, r) => ({
      clicks: acc.clicks + r.clicks,
      impressions: acc.impressions + r.impressions,
      positionSum: acc.positionSum + r.position * r.impressions,
      ctrSum: acc.ctrSum + r.ctr * r.impressions,
    }),
    { clicks: 0, impressions: 0, positionSum: 0, ctrSum: 0 }
  );

  return {
    impressions: totals.impressions,
    clicks: totals.clicks,
    avgPosition: totals.impressions > 0 ? totals.positionSum / totals.impressions : 0,
    ctr: totals.impressions > 0 ? totals.ctrSum / totals.impressions : 0,
    rows,
  };
}

// Convenience: split a date range into prev/current monthly periods for MoM comparisons
export function periodRange(period: string): { startDate: string; endDate: string } {
  // period = "2026-04" → start "2026-04-01", end last day of month
  const [year, month] = period.split('-').map(Number);
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 0)); // day 0 of next month = last day of this month
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return { startDate: fmt(start), endDate: fmt(end) };
}

export function previousPeriod(period: string): string {
  const [y, m] = period.split('-').map(Number);
  const prevMonth = m === 1 ? 12 : m - 1;
  const prevYear = m === 1 ? y - 1 : y;
  return `${prevYear}-${String(prevMonth).padStart(2, '0')}`;
}
