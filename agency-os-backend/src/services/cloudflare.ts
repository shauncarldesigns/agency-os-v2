// Cloudflare Analytics — used only when a Tier 3 client's site routes through CF.
// Lifted the v1 zone-analytics method only; v2 doesn't deploy sites to CF Pages.
import { log } from '../utils/errors';

const CF_API = 'https://api.cloudflare.com/client/v4';

export interface ZoneAnalytics {
  visitors: number;
  pageviews: number;
  bandwidthBytes: number;
}

export async function getZoneAnalytics(
  token: string,
  zoneId: string,
  sinceHours = 720
): Promise<ZoneAnalytics> {
  const res = await fetch(
    `${CF_API}/zones/${zoneId}/analytics/dashboard?since=-${sinceHours}h`,
    { headers: { Authorization: `Bearer ${token}` } }
  );

  if (!res.ok) {
    log('warn', 'cloudflare', `Analytics fetch failed: ${res.status}`);
    return { visitors: 0, pageviews: 0, bandwidthBytes: 0 };
  }

  const data = await res.json() as {
    result?: {
      totals?: {
        visits?: { all: number };
        pageviews?: { all: number };
        bandwidth?: { all: number };
      };
    };
  };

  const totals = data.result?.totals;
  return {
    visitors: totals?.visits?.all ?? 0,
    pageviews: totals?.pageviews?.all ?? 0,
    bandwidthBytes: totals?.bandwidth?.all ?? 0,
  };
}
