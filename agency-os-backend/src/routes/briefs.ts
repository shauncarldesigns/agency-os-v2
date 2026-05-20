import { Hono } from 'hono';
import type { Env, Project, Lead, Brief, BrandAttribute, Testimonial, BriefKind } from '../types';
import { badRequest, notFound, serverError, log } from '../utils/errors';
import { callClaude } from '../services/claude';
import {
  buildMasterBriefPrompt,
  type MasterBriefInput,
  type MasterBriefMode,
} from '../prompts/masterBrief';
import {
  buildMonthlyBatchBriefPrompt,
  type MonthlyBatchInput,
  type MonthlyBatchPageRequest,
} from '../prompts/monthlyBatchBrief';
import type { GoogleReview } from '../services/places';
import type { MinedReviewData } from '../services/reviewMiner';

const BRIEF_MODEL = 'claude-sonnet-4-6';

export const briefsRouter = new Hono<{ Bindings: Env }>();

// ============================================================================
// POST /api/projects/:projectId/briefs/master?mode=homepage_only|full_site
// ============================================================================
briefsRouter.post('/projects/:projectId/briefs/master', async (c) => {
  try {
    const projectId = Number(c.req.param('projectId'));
    if (!Number.isFinite(projectId)) return c.json(badRequest('Invalid projectId'), 400);

    const modeRaw = (c.req.query('mode') ?? 'full_site').toLowerCase();
    if (modeRaw !== 'homepage_only' && modeRaw !== 'full_site') {
      return c.json(badRequest("mode must be 'homepage_only' or 'full_site'"), 400);
    }
    const mode = modeRaw as MasterBriefMode;

    const ctx = await loadProjectContext(c.env, projectId);
    if (!ctx) return c.json(notFound('Project'), 404);

    const input = buildMasterBriefInput(ctx);
    const brief = await generateAndPersistBrief(c.env, {
      projectId,
      kind: mode === 'homepage_only' ? 'homepage_demo' : 'master',
      input,
      mode,
    });

    return c.json(brief, 201);
  } catch (err) {
    log('error', 'briefs', 'POST master brief failed', err);
    return c.json(serverError(`Brief generation failed: ${(err as Error).message}`), 500);
  }
});

// ============================================================================
// POST /api/projects/:projectId/briefs/monthly-batch
// Body: { batchPeriod: '2026-06', pages: [{ service, city }, ...] }
// ============================================================================
briefsRouter.post('/projects/:projectId/briefs/monthly-batch', async (c) => {
  try {
    const projectId = Number(c.req.param('projectId'));
    if (!Number.isFinite(projectId)) return c.json(badRequest('Invalid projectId'), 400);

    const body = (await c.req.json()) as {
      batchPeriod?: string;
      pages?: Array<{ service?: string; city?: string }>;
    };
    if (!body.batchPeriod || !/^\d{4}-\d{2}$/.test(body.batchPeriod)) {
      return c.json(badRequest("batchPeriod required in 'YYYY-MM' format"), 400);
    }
    if (!Array.isArray(body.pages) || body.pages.length === 0) {
      return c.json(badRequest('pages required: non-empty array of { service, city }'), 400);
    }
    for (const p of body.pages) {
      if (!p.service || !p.city) return c.json(badRequest('each page requires service and city'), 400);
    }

    const project = await c.env.DB.prepare('SELECT * FROM projects WHERE id = ?')
      .bind(projectId)
      .first<Project>();
    if (!project) return c.json(notFound('Project'), 404);

    const lead = project.lead_id
      ? await c.env.DB.prepare('SELECT * FROM leads WHERE id = ?').bind(project.lead_id).first<Lead>()
      : null;

    // Pull the most recent master brief for voice recap.
    const masterBrief = await c.env.DB.prepare(
      `SELECT * FROM briefs
       WHERE project_id = ? AND kind = 'master' AND status != 'archived'
       ORDER BY generated_at DESC LIMIT 1`
    )
      .bind(projectId)
      .first<Brief>();

    // Pages already built for this project (for internal-linking context).
    const builtRows = await c.env.DB.prepare(
      `SELECT service, city, published_url
       FROM pages
       WHERE project_id = ? AND status = 'complete' AND service IS NOT NULL AND city IS NOT NULL`
    )
      .bind(projectId)
      .all<{ service: string; city: string; published_url: string | null }>();

    const reviews = collectReviews(project, lead);

    const monthlyInput: MonthlyBatchInput = {
      business_name: project.business_name,
      state: project.state,
      phone: project.phone,
      batch_period: body.batchPeriod,
      monthly_pages_target: project.monthly_pages_target ?? 0,
      brand_voice_summary: project.brand_voice_notes,
      master_brief_excerpt: masterBrief?.content_markdown ?? null,
      already_built_pages: (builtRows.results ?? []).map((r) => ({
        service: r.service,
        city: r.city,
        url: r.published_url,
      })),
      pages: (body.pages as Array<{ service: string; city: string }>).map((p) => ({
        service: p.service,
        city: p.city,
        city_review_quotes: matchReviewsToCity(reviews, p.city),
      })) satisfies MonthlyBatchPageRequest[],
    };

    const { system, user } = buildMonthlyBatchBriefPrompt(monthlyInput);
    const markdown = await callClaude(c.env.CLAUDE_API_KEY, user, {
      model: BRIEF_MODEL,
      systemPrompt: system,
      cacheSystem: true,
      maxTokens: 4000,
      temperature: 0.4,
      timeoutMs: 90_000,
    });

    // Insert brief row (unique on project_id + batch_period — caller must use regenerate to replace).
    const insert = await c.env.DB.prepare(
      `INSERT INTO briefs (project_id, kind, content_markdown, status, batch_period, generated_by_model, generation_input)
       VALUES (?, 'monthly_batch', ?, 'generated', ?, ?, ?)`
    )
      .bind(projectId, markdown, body.batchPeriod, BRIEF_MODEL, JSON.stringify(monthlyInput))
      .run();

    const briefId = insert.meta.last_row_id as number;

    // Create page rows (status='briefed') for each requested page.
    for (const p of body.pages as Array<{ service: string; city: string }>) {
      await c.env.DB.prepare(
        `INSERT INTO pages (project_id, type, service, city, status, brief_id, batch_period)
         VALUES (?, 'service-area', ?, ?, 'briefed', ?, ?)`
      )
        .bind(projectId, p.service, p.city, briefId, body.batchPeriod)
        .run();
    }

    const brief = await c.env.DB.prepare('SELECT * FROM briefs WHERE id = ?').bind(briefId).first<Brief>();
    return c.json(brief, 201);
  } catch (err) {
    log('error', 'briefs', 'POST monthly-batch failed', err);
    return c.json(serverError(`Monthly batch generation failed: ${(err as Error).message}`), 500);
  }
});

// ============================================================================
// GET /api/projects/:projectId/briefs — list all briefs for a project
// ============================================================================
briefsRouter.get('/projects/:projectId/briefs', async (c) => {
  try {
    const projectId = Number(c.req.param('projectId'));
    if (!Number.isFinite(projectId)) return c.json(badRequest('Invalid projectId'), 400);

    const rows = await c.env.DB.prepare(
      `SELECT id, project_id, kind, status, batch_period, generated_by_model, generated_at, completed_at, supersedes_brief_id
       FROM briefs
       WHERE project_id = ?
       ORDER BY generated_at DESC`
    )
      .bind(projectId)
      .all<Omit<Brief, 'content_markdown' | 'generation_input'>>();

    return c.json({ briefs: rows.results ?? [] });
  } catch (err) {
    log('error', 'briefs', 'GET project briefs failed', err);
    return c.json(serverError(), 500);
  }
});

// ============================================================================
// GET /api/briefs/:briefId
// ============================================================================
briefsRouter.get('/briefs/:briefId', async (c) => {
  try {
    const briefId = Number(c.req.param('briefId'));
    if (!Number.isFinite(briefId)) return c.json(badRequest('Invalid briefId'), 400);

    const brief = await c.env.DB.prepare('SELECT * FROM briefs WHERE id = ?').bind(briefId).first<Brief>();
    if (!brief) return c.json(notFound('Brief'), 404);
    return c.json(brief);
  } catch (err) {
    log('error', 'briefs', 'GET brief failed', err);
    return c.json(serverError(), 500);
  }
});

// ============================================================================
// POST /api/briefs/:briefId/regenerate
// Body: { feedback?: string }
// Archives the old brief, generates a new one with supersedes_brief_id set.
// ============================================================================
briefsRouter.post('/briefs/:briefId/regenerate', async (c) => {
  try {
    const briefId = Number(c.req.param('briefId'));
    if (!Number.isFinite(briefId)) return c.json(badRequest('Invalid briefId'), 400);

    const body = (await c.req.json().catch(() => ({}))) as { feedback?: string };

    const old = await c.env.DB.prepare('SELECT * FROM briefs WHERE id = ?').bind(briefId).first<Brief>();
    if (!old) return c.json(notFound('Brief'), 404);

    if (old.kind === 'monthly_batch') {
      return c.json(badRequest('Use POST /projects/:id/briefs/monthly-batch to regenerate a batch brief'), 400);
    }

    const ctx = await loadProjectContext(c.env, old.project_id);
    if (!ctx) return c.json(notFound('Project'), 404);

    const mode: MasterBriefMode = old.kind === 'homepage_demo' ? 'homepage_only' : 'full_site';
    const input = buildMasterBriefInput(ctx);

    const newBrief = await generateAndPersistBrief(c.env, {
      projectId: old.project_id,
      kind: old.kind,
      input,
      mode,
      supersedesBriefId: old.id,
      feedback: body.feedback,
    });

    // Archive the old brief.
    await c.env.DB.prepare("UPDATE briefs SET status = 'archived' WHERE id = ?").bind(old.id).run();

    return c.json(newBrief, 201);
  } catch (err) {
    log('error', 'briefs', 'POST regenerate failed', err);
    return c.json(serverError(`Regenerate failed: ${(err as Error).message}`), 500);
  }
});

// ============================================================================
// PATCH /api/pages/:pageId/complete — operator manually marks a page live
// Body: { publishedUrl: string, notes?: string }
// ============================================================================
briefsRouter.patch('/pages/:pageId/complete', async (c) => {
  try {
    const pageId = Number(c.req.param('pageId'));
    if (!Number.isFinite(pageId)) return c.json(badRequest('Invalid pageId'), 400);

    const body = (await c.req.json()) as { publishedUrl?: string; notes?: string };
    if (!body.publishedUrl || typeof body.publishedUrl !== 'string') {
      return c.json(badRequest('publishedUrl required'), 400);
    }

    const page = await c.env.DB.prepare(
      'SELECT id, project_id FROM pages WHERE id = ?'
    )
      .bind(pageId)
      .first<{ id: number; project_id: number }>();
    if (!page) return c.json(notFound('Page'), 404);

    await c.env.DB.prepare(
      `UPDATE pages
       SET status = 'complete',
           published_url = ?,
           marked_complete_at = datetime('now'),
           operator_notes = COALESCE(?, operator_notes)
       WHERE id = ?`
    )
      .bind(body.publishedUrl, body.notes ?? null, pageId)
      .run();

    await c.env.DB.prepare(
      `UPDATE projects
       SET pages_built = (SELECT COUNT(*) FROM pages WHERE project_id = ? AND status = 'complete'),
           updated_at = datetime('now')
       WHERE id = ?`
    )
      .bind(page.project_id, page.project_id)
      .run();

    const updated = await c.env.DB.prepare('SELECT * FROM pages WHERE id = ?').bind(pageId).first();
    return c.json(updated);
  } catch (err) {
    log('error', 'briefs', 'PATCH page complete failed', err);
    return c.json(serverError(`Page completion failed: ${(err as Error).message}`), 500);
  }
});

// ============================================================================
// Helpers
// ============================================================================

interface ProjectContext {
  project: Project;
  lead: Lead | null;
  brandAttributes: BrandAttribute[];
  testimonials: Testimonial[];
}

async function loadProjectContext(env: Env, projectId: number): Promise<ProjectContext | null> {
  const project = await env.DB.prepare('SELECT * FROM projects WHERE id = ?').bind(projectId).first<Project>();
  if (!project) return null;

  const lead = project.lead_id
    ? await env.DB.prepare('SELECT * FROM leads WHERE id = ?').bind(project.lead_id).first<Lead>()
    : null;

  const ba = await env.DB.prepare(
    'SELECT * FROM brand_attributes WHERE project_id = ? ORDER BY weight DESC, id ASC'
  )
    .bind(projectId)
    .all<BrandAttribute>();

  const ts = await env.DB.prepare(
    'SELECT * FROM testimonials WHERE project_id = ? ORDER BY is_featured DESC, id ASC'
  )
    .bind(projectId)
    .all<Testimonial>();

  return {
    project,
    lead,
    brandAttributes: ba.results ?? [],
    testimonials: ts.results ?? [],
  };
}

function buildMasterBriefInput(ctx: ProjectContext): MasterBriefInput {
  const { project, lead, brandAttributes, testimonials } = ctx;
  const reviews = collectReviews(project, lead);
  const mined = collectMinedData(lead);

  return {
    project: {
      business_name: project.business_name,
      city: project.city,
      state: project.state,
      phone: project.phone,
      email: project.email,
      website: lead?.website ?? null,
      founded_year: project.founded_year ?? project.years_in_business ?? null,
      owner_name: project.owner_name ?? null,
      owner_credentials: project.owner_credentials ?? null,
      tagline: project.tagline ?? null,
      primary_color: project.primary_color ?? null,
      accent_color: project.accent_color ?? null,
      photography_direction: project.photography_direction ?? null,
      monthly_pages_target: project.monthly_pages_target ?? 0,
      tier: project.tier != null ? `tier_${project.tier}` : null,
    },
    mined,
    reviews,
    brand_attributes: brandAttributes.map((b) => ({
      category: b.category,
      value: b.value,
      source: b.source,
    })),
    testimonials: testimonials.map((t) => ({
      author_name: t.author_name,
      author_location: t.author_location,
      quote: t.quote,
      rating: t.rating,
      source: t.source,
      is_featured: t.is_featured === 1,
    })),
    scrape_data: project.scrape_data ?? null,
  };
}

function collectReviews(project: Project, lead: Lead | null): GoogleReview[] {
  // Prefer reviews_snapshot stored on the project (frozen at signing); fall back to lead.
  const candidates = [project.reviews_snapshot, lead?.google_reviews];
  for (const raw of candidates) {
    if (!raw) continue;
    try {
      const v = JSON.parse(raw);
      if (Array.isArray(v)) return v as GoogleReview[];
    } catch {
      // ignore malformed
    }
  }
  return [];
}

function collectMinedData(lead: Lead | null): MinedReviewData {
  const empty: MinedReviewData = {
    service_areas: [],
    services_performed: [],
    owner_names: [],
    strengths: [],
    pitch_quotes: [],
    differentiators: [],
  };
  if (!lead) return empty;
  return {
    services_performed: safeArr(lead.extracted_services),
    service_areas: safeArr(lead.extracted_service_areas),
    owner_names: safeArr(lead.owner_names),
    strengths: safeArr(lead.extracted_strengths),
    pitch_quotes: safeArr(lead.pitch_quotes),
    differentiators: [], // not yet stored on leads
  };
}

function matchReviewsToCity(
  reviews: GoogleReview[],
  city: string
): Array<{ author: string; quote: string }> {
  const needle = city.toLowerCase();
  const matches: Array<{ author: string; quote: string }> = [];
  for (const r of reviews) {
    if (r.text && r.text.toLowerCase().includes(needle)) {
      matches.push({ author: r.author, quote: r.text });
    }
  }
  return matches.slice(0, 3);
}

function safeArr<T = unknown>(raw: string | null | undefined): T[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? (v as T[]) : [];
  } catch {
    return [];
  }
}

interface GenerateOpts {
  projectId: number;
  kind: BriefKind;
  input: MasterBriefInput;
  mode: MasterBriefMode;
  supersedesBriefId?: number;
  feedback?: string;
}

async function generateAndPersistBrief(env: Env, opts: GenerateOpts): Promise<Brief> {
  const { system, user: baseUser } = buildMasterBriefPrompt(opts.input, opts.mode);
  const user = opts.feedback
    ? `${baseUser}\n\n## Operator feedback on the previous draft\n${opts.feedback}\n\nIncorporate the feedback above when producing this revised draft.`
    : baseUser;

  const markdown = await callClaude(env.CLAUDE_API_KEY, user, {
    model: BRIEF_MODEL,
    systemPrompt: system,
    cacheSystem: true,
    maxTokens: 8000,
    temperature: 0.4,
    timeoutMs: 90_000,
  });

  const insert = await env.DB.prepare(
    `INSERT INTO briefs (project_id, kind, content_markdown, status, generated_by_model, generation_input, supersedes_brief_id)
     VALUES (?, ?, ?, 'generated', ?, ?, ?)`
  )
    .bind(
      opts.projectId,
      opts.kind,
      markdown,
      BRIEF_MODEL,
      JSON.stringify(opts.input),
      opts.supersedesBriefId ?? null
    )
    .run();

  const briefId = insert.meta.last_row_id as number;
  const brief = await env.DB.prepare('SELECT * FROM briefs WHERE id = ?').bind(briefId).first<Brief>();
  if (!brief) throw new Error('Insert succeeded but row not found');
  return brief;
}
