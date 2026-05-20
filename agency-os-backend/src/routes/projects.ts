import { Hono } from 'hono';
import type { Env, Lead, Project } from '../types';
import { badRequest, conflict, notFound, serverError, log } from '../utils/errors';
import { generateProjectSlug, slugify } from '../utils/slug';
import { buildPageBriefPrompt } from '../prompts/pageBrief';

export const projectsRouter = new Hono<{ Bindings: Env }>();

const PROJECT_FIELDS = [
  'lead_id', 'name', 'tier', 'business_name', 'industry', 'city', 'state', 'phone', 'email',
  'description', 'years_in_business', 'primary_color', 'brand_voice_notes',
  'services', 'service_areas', 'landingsite_project_id', 'landingsite_url', 'custom_domain',
  'gsc_property_url', 'cf_zone_id', 'client_email',
  'pages_built', 'pages_planned', 'next_pages_due', 'merchynt_active',
  'contract_start', 'contract_min_end', 'status', 'reviews_snapshot',
];

projectsRouter.get('/', async (c) => {
  try {
    const { tier, status } = c.req.query();
    let query = 'SELECT * FROM projects WHERE 1=1';
    const params: unknown[] = [];
    if (tier) { query += ' AND tier = ?'; params.push(parseInt(tier, 10)); }
    if (status) { query += ' AND status = ?'; params.push(status); }
    query += ' ORDER BY tier DESC, updated_at DESC';
    const result = await c.env.DB.prepare(query).bind(...params).all();
    return c.json({ projects: result.results, total: result.results.length });
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
        services, service_areas, pages_planned,
        contract_start, contract_min_end, merchynt_active, status, reviews_snapshot
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'building', ?)
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

projectsRouter.put('/:id', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) return c.json(badRequest('Invalid project ID'), 400);

  const existing = await c.env.DB.prepare('SELECT id FROM projects WHERE id = ?').bind(id).first();
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

    if (updates.length === 0) return c.json(badRequest('No valid fields to update'), 400);

    const setClause = [...updates.map(u => `${u.key} = ?`), "updated_at = datetime('now')"].join(', ');
    const values = [...updates.map(u => u.value), id];

    await c.env.DB.prepare(`UPDATE projects SET ${setClause} WHERE id = ?`).bind(...values).run();
    const updated = await c.env.DB.prepare('SELECT * FROM projects WHERE id = ?').bind(id).first();
    return c.json({ project: updated });
  } catch (err) {
    log('error', 'projects', `PUT /projects/${id} failed`, err);
    return c.json(serverError(), 500);
  }
});

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

// Bulk-expand site with N service-area pages — used by the Coverage Matrix UI.
// For each selected cell, creates a `pages` row and a `brief_jobs` queue entry using
// the template-based per-page prompt (no Claude call needed).
projectsRouter.post('/:id/expand', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) return c.json(badRequest('Invalid project ID'), 400);

  const project = await c.env.DB.prepare('SELECT * FROM projects WHERE id = ?').bind(id).first<Project>();
  if (!project) return c.json(notFound('Project'), 404);

  let body: { pages?: Array<{ type: string; service?: string; city?: string }> };
  try {
    body = await c.req.json();
  } catch {
    return c.json(badRequest('Invalid JSON body'), 400);
  }
  const pages = body.pages ?? [];
  if (!Array.isArray(pages) || pages.length === 0) {
    return c.json(badRequest('pages array required'), 400);
  }
  if (pages.length > 50) return c.json(badRequest('Max 50 pages per expand call'), 400);

  const created: Array<{ pageId: number; jobId: number; service?: string; city?: string }> = [];
  const errors: string[] = [];

  for (const p of pages) {
    if (!p.type) { errors.push('page missing type'); continue; }

    try {
      // 1. Build the slug + URL based on type
      const slug = p.type === 'service-area' && p.service && p.city
        ? `/service-areas/${slugify(p.service)}-${slugify(p.city)}-${(project.state ?? 'wi').toLowerCase()}`
        : p.type === 'service' && p.service
          ? `/services/${slugify(p.service)}`
          : `/${slugify(p.type)}`;

      // 2. Insert pages row
      const pageRes = await c.env.DB.prepare(
        `INSERT INTO pages (project_id, type, service, city, slug, status)
         VALUES (?, ?, ?, ?, ?, 'queued')`
      ).bind(id, p.type, p.service ?? null, p.city ?? null, slug).run();
      const pageId = pageRes.meta.last_row_id as number;

      // 3. Generate the brief markdown (template, no Claude)
      const briefMarkdown = buildPageBriefPrompt({
        businessName: project.business_name,
        phone: project.phone,
        state: project.state,
        brandVoiceNotes: project.brand_voice_notes,
        pageType: p.type as 'homepage' | 'service' | 'service-area' | 'about' | 'faq' | 'contact',
        service: p.service,
        city: p.city,
        serviceAreas: safeParseArray(project.service_areas),
      });

      // 4. Insert brief_jobs row
      const jobRes = await c.env.DB.prepare(
        `INSERT INTO brief_jobs (project_id, page_id, job_type, brief_markdown, status)
         VALUES (?, ?, 'add-page', ?, 'queued')`
      ).bind(id, pageId, briefMarkdown).run();
      const jobId = jobRes.meta.last_row_id as number;

      // 5. Send to Cloudflare Queue (soft-fail in dev)
      try {
        await c.env.BRIEF_QUEUE.send({
          jobId, projectId: id, pageId,
          jobType: 'add-page', briefMarkdown,
        });
      } catch (err) {
        log('warn', 'projects', `Queue send failed for job ${jobId} (manual handoff fallback)`, err);
      }

      created.push({ pageId, jobId, service: p.service, city: p.city });
    } catch (err) {
      errors.push(`${p.service ?? '?'} in ${p.city ?? '?'}: ${(err as Error).message}`);
      log('error', 'projects', 'expand: cell failed', err);
    }
  }

  // Bump project planned-pages count (pages_built only goes up when Cowork webhook reports done)
  if (created.length > 0) {
    await c.env.DB.prepare(
      "UPDATE projects SET pages_planned = pages_planned + ?, updated_at = datetime('now') WHERE id = ?"
    ).bind(created.length, id).run();
  }

  // Estimated time: ~2 min per page
  const estMinutes = created.length * 2;

  log('info', 'projects', `Project ${id} expanded with ${created.length} pages`, { errors: errors.length });
  return c.json({
    created: created.length,
    skipped: errors.length,
    estimatedMinutes: estMinutes,
    pages: created,
    errors: errors.slice(0, 5),
  }, 201);
});

function safeParseArray(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v as string[] : [];
  } catch { return []; }
}
