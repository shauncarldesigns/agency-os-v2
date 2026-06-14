// DNS management routes — mounted at /api/projects/:id/dns/*.
//
// Three operations:
//   POST /:id/dns/setup    — first-time zone creation for a project
//   GET  /:id/dns/status   — fetch live zone status + record match state
//   POST /:id/dns/retry    — re-create any missing landingsite records
//
// /setup is rejected if the project already has cf_zone_id set. Switching
// domains on an existing project goes through the Edit Project flow (Phase 5)
// which calls /setup again after explicit operator confirmation; the old zone
// is intentionally orphaned in Cloudflare for the operator to clean up
// manually (per spec — auto-deletion is out of scope).

import { Hono } from 'hono';
import type { Env, Project } from '../types';
import { badRequest, conflict, notFound, serverError, log } from '../utils/errors';
import {
  createZone,
  getZoneStatus,
  listDnsRecords,
  createDnsRecord,
  CloudflareError,
  type DnsRecord,
} from '../services/cloudflare';
import { LANDINGSITE_DNS_RECORDS, expectedHostname } from '../services/dnsConstants';

export const dnsRouter = new Hono<{ Bindings: Env }>();

// Tight apex-domain regex. Operators routinely paste with protocol, www, or
// trailing slash — normalize first, then validate.
const DOMAIN_RE = /^(?=.{1,253}$)[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/i;

function normalizeDomain(d: string): string {
  return d
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/.*$/, '');
}

// Match a live CF record against an expected landingsite record by
// (type, hostname, content). Case-insensitive on hostname because CF returns
// it lowercase but we want to be defensive.
function recordMatches(
  live: DnsRecord,
  expectedType: string,
  expectedHost: string,
  expectedContent: string
): boolean {
  return (
    live.type === expectedType &&
    live.name.toLowerCase() === expectedHost.toLowerCase() &&
    live.content === expectedContent
  );
}

// POST /:id/dns/setup — body: { domain, registrar?, domain_owner_email? }
//
// Pass ?replace=true to allow operating against a project that already has
// cf_zone_id set — used by the Edit Project domain-change flow (Phase 5).
// The old zone is intentionally orphaned in Cloudflare for the operator to
// clean up manually (auto-deletion is out of scope per spec). The orphaned
// zone_id is logged for audit so it can be located later.
dnsRouter.post('/:id/dns/setup', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) return c.json(badRequest('Invalid project ID'), 400);
  const replace = c.req.query('replace') === 'true';

  const body = (await c.req.json().catch(() => ({}))) as {
    domain?: string;
    registrar?: string;
    domain_owner_email?: string;
  };

  const rawDomain = (body.domain ?? '').trim();
  if (!rawDomain) return c.json(badRequest('domain is required'), 400);
  const domain = normalizeDomain(rawDomain);
  if (!DOMAIN_RE.test(domain)) {
    return c.json(badRequest(`Invalid domain format: "${rawDomain}"`), 400);
  }

  const project = await c.env.DB
    .prepare('SELECT * FROM projects WHERE id = ?')
    .bind(id)
    .first<Project>();
  if (!project) return c.json(notFound('Project'), 404);
  if (project.cf_zone_id && !replace) {
    return c.json(
      conflict(
        `Project already has a Cloudflare zone (${project.cf_zone_id}). Pass ?replace=true to orphan the old zone and create a new one for ${domain}.`
      ),
      409
    );
  }
  if (project.cf_zone_id && replace) {
    log('info', 'dns', `Replacing zone for project ${id}`, {
      oldZoneId: project.cf_zone_id,
      oldDomain: project.domain,
      newDomain: domain,
    });
  }

  // Create the zone first. If this fails (e.g. domain already in another CF
  // account), we abort cleanly without touching the project row.
  let zone;
  try {
    zone = await createZone(c.env.CLOUDFLARE_API_TOKEN, c.env.CLOUDFLARE_ACCOUNT_ID, domain);
  } catch (err) {
    log('error', 'dns', `Zone create failed for project ${id} domain ${domain}`, err);
    const msg = err instanceof CloudflareError ? err.message : (err as Error).message;
    return c.json(serverError(`Cloudflare zone creation failed: ${msg}`), 502);
  }

  // Create the 3 landingsite records. If any fail, persist the zone anyway
  // and mark dns_status='failed' so the operator can call /retry. The zone
  // itself was created successfully — losing track of the zone ID is worse
  // than persisting a partial record set.
  const failures: string[] = [];
  for (const r of LANDINGSITE_DNS_RECORDS) {
    try {
      await createDnsRecord(c.env.CLOUDFLARE_API_TOKEN, zone.id, {
        type: r.type,
        name: expectedHostname(domain, r.subdomain),
        content: r.content,
        comment: r.comment,
      });
    } catch (err) {
      const msg = err instanceof CloudflareError ? err.message : (err as Error).message;
      failures.push(`${r.type} ${r.subdomain} → ${r.content}: ${msg}`);
      log('warn', 'dns', `Record create failed for project ${id}`, { record: r, error: msg });
    }
  }

  const status = failures.length === 0 ? 'pending' : 'failed';
  const now = new Date().toISOString();
  await c.env.DB
    .prepare(
      `UPDATE projects SET
        domain = ?,
        cf_zone_id = ?,
        cf_nameservers = ?,
        dns_status = ?,
        dns_last_checked = ?,
        registrar = ?,
        domain_owner_email = ?,
        updated_at = ?
      WHERE id = ?`
    )
    .bind(
      domain,
      zone.id,
      JSON.stringify(zone.name_servers ?? []),
      status,
      now,
      body.registrar?.trim() || null,
      body.domain_owner_email?.trim() || null,
      now,
      id
    )
    .run();

  log('info', 'dns', `Zone created for project ${id}`, {
    domain,
    zoneId: zone.id,
    status,
    failureCount: failures.length,
  });

  const updated = await c.env.DB
    .prepare('SELECT * FROM projects WHERE id = ?')
    .bind(id)
    .first<Project>();

  return c.json({
    project: updated,
    nameservers: zone.name_servers,
    failures,
    status,
  });
});

// GET /:id/dns/status — pulls live zone + record state from Cloudflare,
// updates dns_last_checked, and flips pending→active if CF reports active.
dnsRouter.get('/:id/dns/status', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) return c.json(badRequest('Invalid project ID'), 400);

  const project = await c.env.DB
    .prepare('SELECT * FROM projects WHERE id = ?')
    .bind(id)
    .first<Project>();
  if (!project) return c.json(notFound('Project'), 404);
  if (!project.cf_zone_id || !project.domain) {
    return c.json(badRequest('Project has no Cloudflare zone — run /setup first'), 400);
  }

  let zone;
  let records: DnsRecord[];
  try {
    [zone, records] = await Promise.all([
      getZoneStatus(c.env.CLOUDFLARE_API_TOKEN, project.cf_zone_id),
      listDnsRecords(c.env.CLOUDFLARE_API_TOKEN, project.cf_zone_id),
    ]);
  } catch (err) {
    log('error', 'dns', `Status fetch failed for project ${id}`, err);
    const msg = err instanceof CloudflareError ? err.message : (err as Error).message;
    return c.json(serverError(`Cloudflare status fetch failed: ${msg}`), 502);
  }

  // For each expected landingsite record, attach found/missing flag based on
  // the live record list. The frontend renders one row per expected record.
  const expectedWithStatus = LANDINGSITE_DNS_RECORDS.map((r) => {
    const hostname = expectedHostname(project.domain!, r.subdomain);
    return {
      type: r.type,
      subdomain: r.subdomain,
      hostname,
      content: r.content,
      found: records.some((live) => recordMatches(live, r.type, hostname, r.content)),
    };
  });

  // Flip dns_status to 'active' on the fly if Cloudflare reports the zone is
  // active and we're still tracking it as 'pending'. The hourly cron does this
  // too, but doing it on manual status checks gives the operator immediate
  // feedback after a registrar nameserver change.
  const now = new Date().toISOString();
  let newStatus = project.dns_status;
  if (project.dns_status === 'pending' && zone.status === 'active') {
    newStatus = 'active';
    await c.env.DB
      .prepare(`UPDATE projects SET dns_status = ?, dns_last_checked = ?, updated_at = ? WHERE id = ?`)
      .bind(newStatus, now, now, id)
      .run();
    log('info', 'dns', `Zone activated on status check for project ${id}`);
  } else {
    await c.env.DB
      .prepare(`UPDATE projects SET dns_last_checked = ? WHERE id = ?`)
      .bind(now, id)
      .run();
  }

  return c.json({
    zone_status: zone.status,
    dns_status: newStatus,
    nameservers: zone.name_servers,
    records: expectedWithStatus,
    last_checked: now,
  });
});

// POST /:id/dns/retry — re-creates any landingsite records that are missing
// from the live zone. No-op if everything's present. Flips status from
// 'failed' back to 'pending' on full recovery.
dnsRouter.post('/:id/dns/retry', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) return c.json(badRequest('Invalid project ID'), 400);

  const project = await c.env.DB
    .prepare('SELECT * FROM projects WHERE id = ?')
    .bind(id)
    .first<Project>();
  if (!project) return c.json(notFound('Project'), 404);
  if (!project.cf_zone_id || !project.domain) {
    return c.json(badRequest('Project has no Cloudflare zone — run /setup first'), 400);
  }

  let existing: DnsRecord[];
  try {
    existing = await listDnsRecords(c.env.CLOUDFLARE_API_TOKEN, project.cf_zone_id);
  } catch (err) {
    log('error', 'dns', `Retry: list records failed for project ${id}`, err);
    const msg = err instanceof CloudflareError ? err.message : (err as Error).message;
    return c.json(serverError(`Cloudflare list failed: ${msg}`), 502);
  }

  const created: string[] = [];
  const failures: string[] = [];
  for (const r of LANDINGSITE_DNS_RECORDS) {
    const hostname = expectedHostname(project.domain, r.subdomain);
    const alreadyPresent = existing.some((live) =>
      recordMatches(live, r.type, hostname, r.content)
    );
    if (alreadyPresent) continue;

    try {
      await createDnsRecord(c.env.CLOUDFLARE_API_TOKEN, project.cf_zone_id, {
        type: r.type,
        name: hostname,
        content: r.content,
        comment: r.comment,
      });
      created.push(`${r.type} ${hostname} → ${r.content}`);
    } catch (err) {
      const msg = err instanceof CloudflareError ? err.message : (err as Error).message;
      failures.push(`${r.type} ${hostname} → ${r.content}: ${msg}`);
      log('warn', 'dns', `Retry: record create failed for project ${id}`, { record: r, error: msg });
    }
  }

  // If we recovered from a failed state, flip back to pending so the cron
  // resumes polling. If we were already pending/active, leave it alone.
  let nextStatus = project.dns_status;
  if (failures.length === 0 && project.dns_status === 'failed') {
    nextStatus = 'pending';
    const now = new Date().toISOString();
    await c.env.DB
      .prepare(`UPDATE projects SET dns_status = 'pending', dns_last_checked = ?, updated_at = ? WHERE id = ?`)
      .bind(now, now, id)
      .run();
  } else if (failures.length > 0 && project.dns_status !== 'failed') {
    nextStatus = 'failed';
    await c.env.DB
      .prepare(`UPDATE projects SET dns_status = 'failed' WHERE id = ?`)
      .bind(id)
      .run();
  }

  log('info', 'dns', `Retry for project ${id}`, {
    createdCount: created.length,
    failureCount: failures.length,
    nextStatus,
  });

  return c.json({
    created,
    failures,
    status: nextStatus,
  });
});
