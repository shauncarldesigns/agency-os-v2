// Cloudflare API client — analytics (read-only) and DNS management (read/write).
//
// Two distinct error models on purpose:
// - getZoneAnalytics() swallows failures and returns zeros, because the
//   reports module is best-effort and shouldn't fail a monthly snapshot
//   just because CF is flaky.
// - All DNS functions throw a typed CloudflareError. The DNS routes need to
//   surface specific failures (e.g. "domain already in another account") to
//   the operator so they can act on them.
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

// ============================================================================
// DNS management — used by routes/dns.ts to create zones + records on demand.
// ============================================================================

export class CloudflareError extends Error {
  constructor(
    public status: number,
    public errors: ReadonlyArray<{ code: number; message: string }>,
    message: string
  ) {
    super(message);
    this.name = 'CloudflareError';
  }
}

interface CfApiResponse<T> {
  success: boolean;
  errors: ReadonlyArray<{ code: number; message: string }>;
  result: T;
}

// Thin fetch wrapper that throws CloudflareError on any non-success response.
// All DNS write paths route through this so error handling stays uniform.
async function cfFetch<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${CF_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  const data = await res.json().catch(() => ({})) as Partial<CfApiResponse<T>>;
  if (!res.ok || data.success === false) {
    const errs = data.errors ?? [];
    const msg = errs.length > 0
      ? errs.map((e) => `[${e.code}] ${e.message}`).join('; ')
      : `HTTP ${res.status}`;
    throw new CloudflareError(res.status, errs, msg);
  }
  return data.result as T;
}

export interface Zone {
  id: string;
  name: string;
  // CF returns more statuses than these but these are the ones we surface.
  status: 'pending' | 'active' | 'initializing' | 'moved' | 'deleted' | 'deactivated';
  name_servers: string[];
}

export async function createZone(
  token: string,
  accountId: string,
  domain: string
): Promise<Zone> {
  return cfFetch<Zone>(token, '/zones', {
    method: 'POST',
    body: JSON.stringify({
      name: domain,
      account: { id: accountId },
      type: 'full',           // full = nameserver delegation (vs partial = CNAME setup)
      jump_start: false,      // do NOT auto-import existing records — we control them
    }),
  });
}

export async function getZoneStatus(token: string, zoneId: string): Promise<Zone> {
  return cfFetch<Zone>(token, `/zones/${zoneId}`);
}

export interface DnsRecord {
  id: string;
  type: string;
  name: string;        // full hostname, e.g. "example.com" or "www.example.com"
  content: string;
  proxied: boolean;
  ttl: number;
  comment?: string;
}

export async function listDnsRecords(token: string, zoneId: string): Promise<DnsRecord[]> {
  // 100 records is the max page size; we never expect more than a handful
  // per zone (3 landingsite records + maybe a few client-imported MX/TXT).
  return cfFetch<DnsRecord[]>(token, `/zones/${zoneId}/dns_records?per_page=100`);
}

export async function createDnsRecord(
  token: string,
  zoneId: string,
  record: { type: string; name: string; content: string; comment?: string }
): Promise<DnsRecord> {
  return cfFetch<DnsRecord>(token, `/zones/${zoneId}/dns_records`, {
    method: 'POST',
    body: JSON.stringify({
      ...record,
      ttl: 1,                 // 1 = "Auto" in Cloudflare's DNS UI
      proxied: false,         // HARD-CODED — see dnsConstants.ts header for why
    }),
  });
}
