import { Hono } from 'hono';
import type { Env, Lead, Project } from '../types';
import { badRequest, conflict, notFound, serverError, log } from '../utils/errors';
import { generateProjectSlug } from '../utils/slug';
import { chicagoToday } from '../services/dayOfWeek';

export const projectsRouter = new Hono<{ Bindings: Env }>();

const PROJECT_FIELDS = [
  'lead_id', 'name', 'tier', 'business_name', 'industry', 'city', 'state', 'phone', 'email',
  'description', 'years_in_business', 'primary_color', 'brand_voice_notes',
  'services', 'service_areas', 'landingsite_project_id', 'landingsite_url', 'custom_domain',
  'gsc_property_url', 'cf_zone_id', 'client_email',
  'pages_built', 'pages_planned', 'next_pages_due', 'merchynt_active',
  'contract_start', 'contract_min_end', 'status', 'reviews_snapshot',
  // v2.1
  'founded_year', 'owner_name', 'owner_credentials', 'accent_color', 'tagline',
  'photography_direction', 'monthly_pages_target',
  // DNS management — operator-editable metadata only. `domain` is
  // intentionally NOT here: domain changes must go through /dns/setup so the
  // Cloudflare zone state stays consistent with the displayed domain. The
  // other system-managed fields (cf_nameservers, dns_status, dns_last_checked)
  // are similarly written exclusively by the DNS endpoints in routes/dns.ts.
  'registrar', 'domain_owner_email',
];

projectsRouter.get('/', async (c) => {
  try {
    const { tier, status } = c.req.query();
    const today = chicagoToday();
    const monthKey = today.slice(0, 7);
    const dayOfMonth = Number(today.slice(8, 10));
    const [year, month] = monthKey.split('-').map(Number);
    const dueDate = `${monthKey}-${String(new Date(Date.UTC(year, month, 0)).getUTCDate()).padStart(2, '0')}`;
    let query = `SELECT projects.*,
      (SELECT COUNT(*) FROM pages WHERE pages.project_id = projects.id AND pages.status = 'briefed') AS pages_needing_build,
      gc.id AS growth_cycle_id,
      gc.period AS growth_cycle_period,
      gc.phase AS growth_cycle_phase,
      gc.status AS growth_cycle_status,
      gc.due_date AS growth_cycle_due_date,
      (SELECT COUNT(*) FROM growth_work_items WHERE cycle_id = gc.id) AS growth_items_total,
      (SELECT COUNT(*) FROM growth_work_items WHERE cycle_id = gc.id AND status = 'complete') AS growth_items_completed,
      (SELECT COUNT(*) FROM growth_work_items WHERE cycle_id = gc.id AND status = 'blocked') AS growth_items_blocked
      ,EXISTS(SELECT 1 FROM briefs ob WHERE ob.project_id=projects.id AND ob.kind='master' AND ob.status!='archived') AS onboarding_has_master
      ,(SELECT COUNT(*) FROM project_onboarding_checks oc WHERE oc.project_id=projects.id AND oc.completed=1) AS onboarding_manual_completed
      FROM projects
      LEFT JOIN growth_cycles gc ON gc.project_id = projects.id AND gc.period = ?
      WHERE 1=1`;
    const params: unknown[] = [monthKey];
    if (tier) { query += ' AND projects.tier = ?'; params.push(parseInt(tier, 10)); }
    if (status) { query += ' AND projects.status = ?'; params.push(status); }
    query += ' ORDER BY projects.tier DESC, projects.updated_at DESC';
    const result = await c.env.DB.prepare(query).bind(...params).all();
    const projects = result.results.map((row) => {
      const project = row as Record<string, unknown>;
      const total = Number(project.growth_items_total || 0);
      const completed = Number(project.growth_items_completed || 0);
      const blocked = Number(project.growth_items_blocked || 0);
      const hasCycle = Number(project.growth_cycle_id || 0) > 0;
      const onboardingCompleted = 1
        + (project.contract_start ? 1 : 0)
        + (project.domain || project.custom_domain ? 1 : 0)
        + (project.cf_zone_id ? 1 : 0)
        + (project.dns_status === 'active' ? 1 : 0)
        + (Number(project.onboarding_has_master || 0) > 0 ? 1 : 0)
        + (project.gsc_property_url ? 1 : 0)
        + (project.client_email ? 1 : 0)
        + (project.status === 'live' && (project.custom_domain || project.landingsite_url) ? 1 : 0)
        + Number(project.onboarding_manual_completed || 0);
      const health = !hasCycle || blocked > 0 || (total > completed && dayOfMonth >= 24)
        ? 'urgent'
        : total > completed && dayOfMonth >= 15 ? 'attention' : 'healthy';
      return {
        ...project,
        growth_cycle_due_date: project.growth_cycle_due_date || dueDate,
        growth_cycle_health: health,
        onboarding_completed: onboardingCompleted,
        onboarding_total: 13,
        onboarding_percent: Math.round((onboardingCompleted / 13) * 100),
      };
    });
    return c.json({ projects, total: projects.length });
  } catch (err) {
    log('error', 'projects', 'GET /projects failed', err);
    return c.json(serverError(), 500);
  }
});

projectsRouter.get('/:id', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) return c.json(badRequest('Invalid project ID'), 400);

  const project = await c.env.DB.prepare('SELECT * FROM projects WHERE id = ?').bind(id).first();
  if (!project) return c.json(notFound('Project'), 404);

  const pages = await c.env.DB
    .prepare('SELECT * FROM pages WHERE project_id = ? ORDER BY created_at ASC')
    .bind(id).all();

  return c.json({ project, pages: pages.results });
});

// GET /api/projects/:id/discovery
projectsRouter.get('/:id/discovery', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) return c.json(badRequest('Invalid project ID'), 400);
  const project = await c.env.DB.prepare('SELECT id, status FROM projects WHERE id = ?')
    .bind(id).first<{ id: number; status: string }>();
  if (!project) return c.json(notFound('Project'), 404);
  const discovery = await c.env.DB.prepare('SELECT * FROM project_discovery WHERE project_id = ?')
    .bind(id).first();
  return c.json({ discovery: discovery ?? null, eligible: project.status !== 'prospect' });
});

// PUT /api/projects/:id/discovery
// Prospect projects require explicit test mode; signed clients save normally.
projectsRouter.put('/:id/discovery', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) return c.json(badRequest('Invalid project ID'), 400);
  try {
    const project = await c.env.DB.prepare('SELECT id, status, business_name FROM projects WHERE id = ?')
      .bind(id).first<{ id: number; status: string; business_name: string }>();
    if (!project) return c.json(notFound('Project'), 404);
    const body = await c.req.json() as {
      answers?: Record<string, unknown>;
      status?: 'draft' | 'complete';
      testMode?: boolean;
    };
    const testMode = project.status === 'prospect' ? body.testMode === true : false;
    if (project.status === 'prospect' && !testMode) {
      return c.json(badRequest('Prospect discovery requires test mode.'), 400);
    }
    const status = body.status === 'complete' ? 'complete' : 'draft';
    const answers = body.answers && typeof body.answers === 'object' ? body.answers : {};
    const statements = [
      c.env.DB.prepare(
        `INSERT INTO project_discovery
         (project_id, status, is_test_mode, answers_json, completed_at, updated_at)
       VALUES (?, ?, ?, ?, CASE WHEN ? = 'complete' THEN datetime('now') ELSE NULL END, datetime('now'))
       ON CONFLICT(project_id) DO UPDATE SET
         status = excluded.status,
         is_test_mode = excluded.is_test_mode,
         answers_json = excluded.answers_json,
         completed_at = CASE
           WHEN excluded.status = 'complete' THEN COALESCE(project_discovery.completed_at, datetime('now'))
           ELSE NULL
         END,
         updated_at = datetime('now')`
      ).bind(id, status, testMode ? 1 : 0, JSON.stringify(answers), status),
    ];

    // Project Info is the structured source of truth. Completing Discovery
    // promotes overlapping durable facts so Edit Project Info, Brief Studio,
    // and the Page Matrix all read the same values. Domain itself stays out:
    // changing it must go through /dns/setup to preserve Cloudflare state.
    if (status === 'complete') {
      const services = uniqueStrings([
        ...answerList(answers.priority_services),
        ...answerList(answers.missing_services),
      ]);
      const serviceAreas = uniqueStrings(answerList(answers.current_service_cities));
      statements.push(
        c.env.DB.prepare(
          `UPDATE projects
              SET business_name = ?,
                  owner_name = ?,
                  founded_year = ?,
                  phone = ?,
                  email = ?,
                  owner_credentials = ?,
                  tagline = ?,
                  services = ?,
                  service_areas = ?,
                  registrar = ?,
                  domain_owner_email = ?,
                  updated_at = datetime('now')
            WHERE id = ?`
        ).bind(
          answerText(answers.business_name) ?? project.business_name,
          answerText(answers.owner_name),
          answerInteger(answers.founded_year),
          answerText(answers.phone),
          answerText(answers.email),
          answerText(answers.owner_credentials),
          answerText(answers.tagline),
          JSON.stringify(services),
          JSON.stringify(serviceAreas),
          answerText(answers.registrar),
          answerText(answers.domain_owner_email),
          id,
        ),
      );
    }

    await c.env.DB.batch(statements);
    const discovery = await c.env.DB.prepare('SELECT * FROM project_discovery WHERE project_id = ?')
      .bind(id).first();
    const updatedProject = status === 'complete'
      ? await c.env.DB.prepare('SELECT * FROM projects WHERE id = ?').bind(id).first()
      : null;
    return c.json({ discovery, project: updatedProject });
  } catch (err) {
    log('error', 'projects', `PUT /projects/${id}/discovery failed`, err);
    return c.json(serverError(), 500);
  }
});

// DELETE /api/projects/:id/discovery — clears a test/draft and restores blank state.
projectsRouter.delete('/:id/discovery', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) return c.json(badRequest('Invalid project ID'), 400);
  await c.env.DB.prepare('DELETE FROM project_discovery WHERE project_id = ?').bind(id).run();
  return c.body(null, 204);
});

// Convert a lead → project (signing flow). Body: { leadId, tier? (override), name?, services?, service_areas? }
projectsRouter.post('/', async (c) => {
  try {
    const body = await c.req.json() as Record<string, unknown>;
    const leadId = body.leadId as number | undefined;

    let leadData: Lead | null = null;
    if (leadId) {
      leadData = await c.env.DB.prepare('SELECT * FROM leads WHERE id = ?').bind(leadId).first<Lead>();
      if (!leadData) return c.json(notFound('Lead'), 404);
    }

    const businessName = (body.business_name as string) ?? leadData?.company;
    if (!businessName) return c.json(badRequest('business_name (or leadId with valid lead) required'), 400);

    const tier = (body.tier as 1 | 2 | 3) ?? leadData?.recommended_tier ?? 1;
    if (![1, 2, 3].includes(tier)) return c.json(badRequest('tier must be 1, 2, or 3'), 400);

    const city = (body.city as string) ?? leadData?.city ?? 'Unknown';
    const state = (body.state as string) ?? leadData?.state ?? 'WI';
    const slug = generateProjectSlug(businessName, city ?? '', state ?? 'WI');

    // Slug uniqueness
    const existing = await c.env.DB.prepare('SELECT id FROM projects WHERE slug = ?').bind(slug).first();
    if (existing) return c.json(conflict('A project with this slug already exists'), 409);

    // Pull services + service_areas: prefer body, then lead's mined data
    const services = body.services as string[] | undefined
      ?? safeParseArray(leadData?.extracted_services ?? null);
    const serviceAreas = body.service_areas as string[] | undefined
      ?? safeParseArray(leadData?.extracted_service_areas ?? null);

    // Pages planned default by tier
    const pagesPlanned = (body.pages_planned as number | undefined)
      ?? (tier === 3 ? 15 : 5);

    // Tier 3 contract dates
    const now = new Date();
    const contractStart = tier === 3 ? now.toISOString() : null;
    const contractMinEnd = tier === 3
      ? new Date(now.getFullYear(), now.getMonth() + 6, now.getDate()).toISOString()
      : null;
    const merchyntActive = tier === 3 ? 1 : 0;

    const insertResult = await c.env.DB.prepare(`
      INSERT INTO projects (
        lead_id, name, slug, tier, business_name, industry, city, state, phone, email,
        description, years_in_business, primary_color, brand_voice_notes,
        services, service_areas, pages_planned, monthly_pages_target,
        contract_start, contract_min_end, merchynt_active, status, reviews_snapshot
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'building', ?)
    `).bind(
      leadId ?? null,
      businessName,
      slug,
      tier,
      businessName,
      (body.industry as string | undefined) ?? leadData?.industry ?? null,
      city,
      state,
      (body.phone as string | undefined) ?? leadData?.phone ?? null,
      (body.email as string | undefined) ?? leadData?.email ?? null,
      (body.description as string | undefined) ?? null,
      (body.years_in_business as number | undefined) ?? null,
      (body.primary_color as string | undefined) ?? null,
      (body.brand_voice_notes as string | undefined) ?? null,
      JSON.stringify(services),
      JSON.stringify(serviceAreas),
      pagesPlanned,
      tier === 3 ? 3 : 0,
      contractStart,
      contractMinEnd,
      merchyntActive,
      leadData?.google_reviews ?? null,
    ).run();

    // Mark the lead as 'client' and link project_id
    if (leadId) {
      await c.env.DB.prepare(
        "UPDATE leads SET status = 'client', project_id = ?, updated_at = datetime('now') WHERE id = ?"
      ).bind(insertResult.meta.last_row_id, leadId).run();
    }

    const project = await c.env.DB.prepare('SELECT * FROM projects WHERE id = ?')
      .bind(insertResult.meta.last_row_id).first();

    log('info', 'projects', `Project ${insertResult.meta.last_row_id} created from lead ${leadId ?? 'manual'}`, { tier, slug });
    return c.json({ project }, 201);
  } catch (err) {
    log('error', 'projects', 'POST /projects failed', err);
    return c.json(serverError(`${(err as Error).message}`), 500);
  }
});

// DELETE /api/projects/:id
// Hard-delete a project. Cascades to pages/briefs/brand_attributes/testimonials
// via ON DELETE CASCADE in the schema. Reverts the linked lead back to
// 'qualified' status with project_id cleared so the operator can re-qualify or
// move on. Used when a client churns — the project disappears from Sites and
// their lead is recoverable in the Pipeline.
projectsRouter.delete('/:id', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) return c.json(badRequest('Invalid project ID'), 400);

  const project = await c.env.DB
    .prepare('SELECT id, lead_id FROM projects WHERE id = ?')
    .bind(id)
    .first<{ id: number; lead_id: number | null }>();
  if (!project) return c.json(notFound('Project'), 404);

  try {
    // Revert the lead first so it survives even if the project delete races
    // with another request reading lead.project_id. Status target is
    // 'contacted' — under the post-Phase-0 vocabulary, 'qualified' means
    // "demo booked, project exists, awaiting outcome", so a lead with no
    // project can't be qualified by definition.
    if (project.lead_id) {
      await c.env.DB.prepare(
        "UPDATE leads SET project_id = NULL, status = 'contacted', updated_at = datetime('now') WHERE id = ?"
      ).bind(project.lead_id).run();
    }

    await c.env.DB.prepare('DELETE FROM projects WHERE id = ?').bind(id).run();
    log('info', 'projects', `Project ${id} deleted; lead ${project.lead_id ?? '(none)'} reverted to contacted`);
    return c.body(null, 204);
  } catch (err) {
    log('error', 'projects', `DELETE /projects/${id} failed`, err);
    return c.json(serverError(`${(err as Error).message}`), 500);
  }
});

// POST /:id/demo-passed — operator hit the "Demo passed" button on a prospect
// card. The held demo concluded with a decline. Project stays as a 'dead'
// historical record (per spec — preserves audit trail vs clean Sites tab).
// Lead goes back to 'contacted' and is unlinked so it can re-enter the
// calling pool. Project keeps its lead_id back-reference for traceability.
projectsRouter.post('/:id/demo-passed', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) return c.json(badRequest('Invalid project ID'), 400);

  const project = await c.env.DB
    .prepare('SELECT id, lead_id, status FROM projects WHERE id = ?')
    .bind(id)
    .first<{ id: number; lead_id: number | null; status: string }>();
  if (!project) return c.json(notFound('Project'), 404);

  try {
    await c.env.DB.prepare(
      "UPDATE projects SET status = 'dead', updated_at = datetime('now') WHERE id = ?"
    ).bind(id).run();

    if (project.lead_id) {
      await c.env.DB.prepare(
        "UPDATE leads SET status = 'contacted', project_id = NULL, updated_at = datetime('now') WHERE id = ?"
      ).bind(project.lead_id).run();
    }

    log('info', 'projects', `Project ${id} marked demo-passed; lead ${project.lead_id ?? '(none)'} → contacted`);
    const updated = await c.env.DB.prepare('SELECT * FROM projects WHERE id = ?').bind(id).first();
    return c.json({ project: updated });
  } catch (err) {
    log('error', 'projects', `POST /projects/${id}/demo-passed failed`, err);
    return c.json(serverError(`Demo-passed failed: ${(err as Error).message}`), 500);
  }
});

projectsRouter.put('/:id', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) return c.json(badRequest('Invalid project ID'), 400);

  const existing = await c.env.DB.prepare('SELECT id, tier, services, service_areas, pages_planned, pages_built FROM projects WHERE id = ?').bind(id).first<Pick<Project, 'id' | 'tier' | 'services' | 'service_areas' | 'pages_planned' | 'pages_built'>>();
  if (!existing) return c.json(notFound('Project'), 404);

  try {
    const body = await c.req.json() as Record<string, unknown>;
    const updates = Object.entries(body)
      .filter(([k]) => PROJECT_FIELDS.includes(k))
      .map(([k, v]) => {
        let val: unknown = v;
        if (k === 'merchynt_active') val = v ? 1 : 0;
        if ((k === 'services' || k === 'service_areas') && Array.isArray(v)) val = JSON.stringify(v);
        return { key: k, value: val ?? null };
      });

    // Preserve any intentionally planned pages outside the generated matrix,
    // while adding/removing the exact number of matrix cells introduced by a
    // service or service-area change.
    if (existing.tier === 3 && body.pages_planned === undefined && (body.services !== undefined || body.service_areas !== undefined)) {
      const oldServices = safeParseArray(existing.services);
      const oldAreas = safeParseArray(existing.service_areas);
      const newServices = Array.isArray(body.services) ? body.services.map(String) : oldServices;
      const newAreas = Array.isArray(body.service_areas) ? body.service_areas.map(String) : oldAreas;
      const matrixDelta = matrixPlannedCount(newServices, newAreas) - matrixPlannedCount(oldServices, oldAreas);
      updates.push({ key: 'pages_planned', value: Math.max(existing.pages_built ?? 0, (existing.pages_planned ?? 0) + matrixDelta) });
    }

    if (updates.length === 0) return c.json(badRequest('No valid fields to update'), 400);

    const setClause = [...updates.map(u => `${u.key} = ?`), "updated_at = datetime('now')"].join(', ');
    const values = [...updates.map(u => u.value), id];

    await c.env.DB.prepare(`UPDATE projects SET ${setClause} WHERE id = ?`).bind(...values).run();
    if (updates.some((update) => update.key === 'status' && ['building', 'live', 'paused'].includes(String(update.value)))) {
      await c.env.DB.prepare(
        `UPDATE project_discovery
            SET is_test_mode = 0, updated_at = datetime('now')
          WHERE project_id = ?`
      ).bind(id).run();
    }
    const updated = await c.env.DB.prepare('SELECT * FROM projects WHERE id = ?').bind(id).first();
    return c.json({ project: updated });
  } catch (err) {
    log('error', 'projects', `PUT /projects/${id} failed`, err);
    return c.json(serverError(), 500);
  }
});

function matrixPlannedCount(services: string[], areas: string[]): number {
  const foundation = areas.length >= 2 ? 6 : 5;
  return foundation + services.length + (areas.length >= 2 ? services.length * areas.length : 0);
}

// SEO coverage matrix: cross-product of services × service_areas, with built/queued state from pages table.
projectsRouter.get('/:id/coverage', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) return c.json(badRequest('Invalid project ID'), 400);

  const project = await c.env.DB.prepare('SELECT * FROM projects WHERE id = ?').bind(id).first<Project>();
  if (!project) return c.json(notFound('Project'), 404);

  const services = safeParseArray(project.services);
  const cities = safeParseArray(project.service_areas);
  if (project.city && !cities.includes(project.city)) cities.unshift(project.city);

  const pageRes = await c.env.DB
    .prepare("SELECT type, service, city, status FROM pages WHERE project_id = ? AND type = 'service-area'")
    .bind(id).all();
  const pages = pageRes.results as Array<{ type: string; service: string; city: string; status: string }>;
  const pageKey = (svc: string, city: string) => `${svc}::${city}`.toLowerCase();
  const built = new Map<string, string>(); // key → status
  for (const p of pages) built.set(pageKey(p.service ?? '', p.city ?? ''), p.status);

  // Recommended cells = mined service_areas (i.e. not the home city) where no page exists yet
  const homeCity = (project.city ?? '').toLowerCase();
  const minedAreas = new Set(safeParseArray(project.service_areas).map(s => s.toLowerCase()));

  const matrix = cities.map(city => ({
    city,
    inReviews: minedAreas.has(city.toLowerCase()) && city.toLowerCase() !== homeCity,
    cells: services.map(svc => {
      const status = built.get(pageKey(svc, city));
      let state: 'built' | 'building' | 'queued' | 'recommended' | 'available';
      if (status === 'built') state = 'built';
      else if (status === 'building') state = 'building';
      else if (status === 'queued') state = 'queued';
      else if (minedAreas.has(city.toLowerCase()) && city.toLowerCase() !== homeCity) state = 'recommended';
      else state = 'available';
      return { service: svc, city, state };
    }),
  }));

  const totalCells = services.length * cities.length;
  const builtCount = pages.filter(p => p.status === 'built').length;
  return c.json({
    services,
    cities,
    matrix,
    summary: {
      total: totalCells,
      built: builtCount,
      available: totalCells - builtCount,
      pct: totalCells > 0 ? Math.round((builtCount / totalCells) * 100) : 0,
    },
  });
});

function safeParseArray(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v as string[] : [];
  } catch { return []; }
}

function answerText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function answerInteger(value: unknown): number | null {
  const text = answerText(value);
  if (!text) return null;
  const parsed = Number.parseInt(text, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function answerList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim()).filter(Boolean);
  }
  if (typeof value !== 'string') return [];
  return value.split(/[\n,]/).map((item) => item.trim()).filter(Boolean);
}

function uniqueStrings(items: string[]): string[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = item.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
