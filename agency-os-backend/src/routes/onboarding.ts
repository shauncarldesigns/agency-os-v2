import { Hono } from 'hono';
import type { Env } from '../types';
import { badRequest, notFound, serverError, log } from '../utils/errors';

export const onboardingRouter = new Hono<{ Bindings: Env }>();

const MANUAL_ITEMS = [
  { key: 'gbp_claimed', label: 'Claim or verify Google Business Profile', description: 'Confirm ownership and access for the client’s Google Business Profile.' },
  { key: 'paige_setup', label: 'Configure Google Business in Paige', description: 'Add the client, connect the profile, and confirm the recurring management setup.' },
  { key: 'assets_received', label: 'Receive client photos and brand assets', description: 'Collect logos, project photos, team photos, certifications, and other proof.' },
  { key: 'client_approval', label: 'Receive client launch approval', description: 'Record final approval before the website is published.' },
] as const;

onboardingRouter.get('/projects/:id/onboarding', async (c) => {
  try {
    const projectId = Number(c.req.param('id'));
    if (!Number.isFinite(projectId)) return c.json(badRequest('Invalid project id'), 400);
    const project = await c.env.DB.prepare('SELECT * FROM projects WHERE id = ?').bind(projectId).first<Record<string, unknown>>();
    if (!project) return c.json(notFound('Project'), 404);
    const [master, manualRows] = await Promise.all([
      c.env.DB.prepare("SELECT id FROM briefs WHERE project_id=? AND kind='master' AND status!='archived' LIMIT 1").bind(projectId).first(),
      c.env.DB.prepare('SELECT * FROM project_onboarding_checks WHERE project_id=?').bind(projectId).all<Record<string, unknown>>(),
    ]);
    const manualByKey = new Map(manualRows.results.map((row) => [String(row.item_key), row]));
    const automatic = [
      { key: 'client_created', label: 'Create client workspace', description: 'Client information and workspace are available.', completed: true },
      { key: 'contract_started', label: 'Record contract start', description: 'The agreement start date establishes the client relationship.', completed: Boolean(project.contract_start) },
      { key: 'domain_obtained', label: 'Obtain and record the domain', description: 'The production domain is recorded for this client.', completed: Boolean(project.domain || project.custom_domain) },
      { key: 'dns_added', label: 'Add domain and DNS', description: 'A Cloudflare zone and required DNS records have been created.', completed: Boolean(project.cf_zone_id) },
      { key: 'dns_active', label: 'Activate DNS', description: 'Cloudflare reports that nameserver delegation is active.', completed: project.dns_status === 'active' },
      { key: 'master_brief', label: 'Complete master brief', description: 'Brief Studio has an active master brief.', completed: Boolean(master) },
      { key: 'search_console', label: 'Connect Google Search Console', description: 'A Search Console property is recorded for reporting.', completed: Boolean(project.gsc_property_url) },
      { key: 'report_recipient', label: 'Set report recipient', description: 'A client reporting email is configured.', completed: Boolean(project.client_email) },
      { key: 'site_published', label: 'Publish the website', description: 'The project is marked live and has a production URL.', completed: project.status === 'live' && Boolean(project.custom_domain || project.landingsite_url) },
    ].map((item) => ({ ...item, mode: 'automatic' as const }));
    const manual = MANUAL_ITEMS.map((item) => {
      const row = manualByKey.get(item.key);
      return { ...item, mode: 'manual' as const, completed: Number(row?.completed ?? 0) === 1, completed_at: row?.completed_at ?? null, notes: row?.notes ?? null };
    });
    const items = [...automatic, ...manual];
    return c.json({ items, completed: items.filter((item) => item.completed).length, total: items.length });
  } catch (err) {
    log('error', 'onboarding', 'Load checklist failed', err);
    return c.json(serverError(), 500);
  }
});

onboardingRouter.patch('/projects/:id/onboarding/:key', async (c) => {
  try {
    const projectId = Number(c.req.param('id'));
    const key = c.req.param('key');
    if (!MANUAL_ITEMS.some((item) => item.key === key)) return c.json(badRequest('This onboarding item is not manually editable'), 400);
    const project = await c.env.DB.prepare('SELECT id FROM projects WHERE id=?').bind(projectId).first();
    if (!project) return c.json(notFound('Project'), 404);
    const body = await c.req.json() as { completed?: boolean; notes?: string | null };
    await c.env.DB.prepare(`INSERT INTO project_onboarding_checks (project_id,item_key,completed,completed_at,notes) VALUES (?,?,?,?,?)
      ON CONFLICT(project_id,item_key) DO UPDATE SET completed=excluded.completed, completed_at=excluded.completed_at, notes=excluded.notes, updated_at=datetime('now')`)
      .bind(projectId, key, body.completed ? 1 : 0, body.completed ? new Date().toISOString() : null, body.notes?.trim() || null).run();
    return c.json({ success: true });
  } catch (err) {
    log('error', 'onboarding', 'Update checklist failed', err);
    return c.json(serverError(), 500);
  }
});
