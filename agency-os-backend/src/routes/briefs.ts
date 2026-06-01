import { Hono } from 'hono';
import type { Env, Project, Lead, Brief, BrandAttribute, Testimonial } from '../types';
import { badRequest, notFound, serverError, log } from '../utils/errors';
import { callClaude } from '../services/claude';
import {
  buildMasterBriefPrompt,
  type MasterBriefInput,
} from '../prompts/masterBrief';
import { buildPageBriefPrompt, type PageSpec, type PageType } from '../prompts/pageBrief';
import { buildMatrixForProject } from '../services/matrix';
import { slugify } from '../utils/slug';
import { countTbds } from '../utils/tbd';
import type { GoogleReview } from '../services/places';
import type { MinedReviewData } from '../services/reviewMiner';

// Opus 4.7 for brief generation. Briefs are synthesis-heavy (mining quotes,
// picking angles, weighing differentiators) and run a handful of times per
// project, not in a hot loop — the quality bump is worth the ~5x cost vs
// Sonnet 4.6. Prompt caching is on, so the system prompt is paid once per
// cache window. If cost becomes a concern, the split-model option is:
// keep Opus for master (1 call/project, biggest synthesis lift) and drop
// page briefs back to Sonnet (N calls/project, just extracts from master).
const BRIEF_MODEL = 'claude-opus-4-7';

export const briefsRouter = new Hono<{ Bindings: Env }>();

// ============================================================================
// MASTER BRIEF
// ============================================================================

// POST /api/projects/:projectId/briefs/master
// Generates the project's master brief (first version).
briefsRouter.post('/projects/:projectId/briefs/master', async (c) => {
  try {
    const projectId = Number(c.req.param('projectId'));
    if (!Number.isFinite(projectId)) return c.json(badRequest('Invalid projectId'), 400);

    const ctx = await loadProjectContext(c.env, projectId);
    if (!ctx) return c.json(notFound('Project'), 404);

    const existing = await c.env.DB
      .prepare("SELECT id FROM briefs WHERE project_id = ? AND kind = 'master' AND supersedes_brief_id IS NULL")
      .bind(projectId)
      .first<{ id: number }>();
    if (existing) {
      return c.json(
        badRequest('Master brief already exists. Use /master/regenerate to create a new version.'),
        409
      );
    }

    const input = buildMasterBriefInput(ctx);
    const brief = await generateMasterBrief(c.env, projectId, input, /* version */ 1);
    return c.json(brief, 201);
  } catch (err) {
    log('error', 'briefs', 'POST master failed', err);
    return c.json(serverError(`Master brief generation failed: ${(err as Error).message}`), 500);
  }
});

// GET /api/projects/:projectId/briefs/master — current master (any version > 0, supersedes IS NULL)
briefsRouter.get('/projects/:projectId/briefs/master', async (c) => {
  try {
    const projectId = Number(c.req.param('projectId'));
    if (!Number.isFinite(projectId)) return c.json(badRequest('Invalid projectId'), 400);

    const brief = await c.env.DB
      .prepare(
        `SELECT * FROM briefs
         WHERE project_id = ? AND kind = 'master' AND supersedes_brief_id IS NULL
         LIMIT 1`
      )
      .bind(projectId)
      .first<Brief>();
    if (!brief) return c.json(notFound('Master brief'), 404);
    return c.json(brief);
  } catch (err) {
    log('error', 'briefs', 'GET master failed', err);
    return c.json(serverError(), 500);
  }
});

// POST /api/projects/:projectId/briefs/master/regenerate
// Body: { feedback?: string }
// Archives the current master and generates v+1 with optional feedback.
briefsRouter.post('/projects/:projectId/briefs/master/regenerate', async (c) => {
  try {
    const projectId = Number(c.req.param('projectId'));
    if (!Number.isFinite(projectId)) return c.json(badRequest('Invalid projectId'), 400);
    const body = (await c.req.json().catch(() => ({}))) as { feedback?: string };

    const current = await c.env.DB
      .prepare(
        `SELECT * FROM briefs
         WHERE project_id = ? AND kind = 'master' AND supersedes_brief_id IS NULL`
      )
      .bind(projectId)
      .first<Brief>();
    if (!current) return c.json(notFound('Master brief'), 404);

    const ctx = await loadProjectContext(c.env, projectId);
    if (!ctx) return c.json(notFound('Project'), 404);

    const input = buildMasterBriefInput(ctx);

    // Archive the current one first so the partial-unique-index doesn't reject the insert.
    await c.env.DB
      .prepare("UPDATE briefs SET status = 'archived', supersedes_brief_id = ? WHERE id = ?")
      .bind(current.id, current.id) // chained on itself; supersedes_brief_id no longer NULL
      .run();

    const next = await generateMasterBrief(
      c.env,
      projectId,
      input,
      current.version + 1,
      body.feedback?.trim() || undefined
    );

    return c.json(next, 201);
  } catch (err) {
    log('error', 'briefs', 'POST master/regenerate failed', err);
    return c.json(serverError(`Regenerate failed: ${(err as Error).message}`), 500);
  }
});

// ============================================================================
// PAGE BRIEFS
// ============================================================================

// POST /api/projects/:projectId/pages/:pageId/brief
// Generates a brief for the given page using the project's master brief as context.
briefsRouter.post('/projects/:projectId/pages/:pageId/brief', async (c) => {
  try {
    const projectId = Number(c.req.param('projectId'));
    const pageId = Number(c.req.param('pageId'));
    if (!Number.isFinite(projectId) || !Number.isFinite(pageId)) {
      return c.json(badRequest('Invalid projectId or pageId'), 400);
    }

    const page = await c.env.DB
      .prepare('SELECT * FROM pages WHERE id = ? AND project_id = ?')
      .bind(pageId, projectId)
      .first<{
        id: number;
        type: string;
        service: string | null;
        city: string | null;
        status: string;
      }>();
    if (!page) return c.json(notFound('Page'), 404);

    const master = await c.env.DB
      .prepare(
        `SELECT content_markdown FROM briefs
         WHERE project_id = ? AND kind = 'master' AND supersedes_brief_id IS NULL`
      )
      .bind(projectId)
      .first<{ content_markdown: string }>();
    if (!master) {
      return c.json(badRequest('Generate the master brief before page briefs.'), 400);
    }

    const spec = pageSpecFromRow(page);
    const { system, user } = buildPageBriefPrompt(master.content_markdown, spec);
    const markdown = await callClaude(c.env.CLAUDE_API_KEY, user, {
      model: BRIEF_MODEL,
      systemPrompt: system,
      cacheSystem: true,
      maxTokens: 4000,
      // NOTE: Opus 4.7 ignores temperature (the Claude service strips it), so
      // brief variance now comes entirely from the angle-led prompt, not this
      // value. Kept for the case where BRIEF_MODEL is downgraded to a model
      // that does honor it (e.g. Sonnet), where 0.8 gave good differentiation.
      temperature: 0.8,
      timeoutMs: 90_000,
    });

    const tbds = countTbds(markdown);

    const insert = await c.env.DB
      .prepare(
        `INSERT INTO briefs
           (project_id, kind, page_id, content_markdown, status, version, tbd_count,
            generated_by_model, generation_input, updated_at)
         VALUES (?, 'page', ?, ?, 'briefed', 1, ?, ?, ?, datetime('now'))`
      )
      .bind(projectId, pageId, markdown, tbds, BRIEF_MODEL, JSON.stringify({ spec }))
      .run();
    const briefId = insert.meta.last_row_id as number;

    // Wire the page to its brief and flip status to 'briefed'.
    await c.env.DB
      .prepare(
        `UPDATE pages SET brief_id = ?, status = 'briefed' WHERE id = ?`
      )
      .bind(briefId, pageId)
      .run();

    const brief = await c.env.DB.prepare('SELECT * FROM briefs WHERE id = ?').bind(briefId).first<Brief>();
    return c.json(brief, 201);
  } catch (err) {
    log('error', 'briefs', 'POST page brief failed', err);
    return c.json(serverError(`Page brief generation failed: ${(err as Error).message}`), 500);
  }
});

// POST /api/projects/:projectId/pages — create a page row (used when the
// matrix needs to materialize a cell before generating its brief).
// Body: { type, service?, city?, customTitle? }
briefsRouter.post('/projects/:projectId/pages', async (c) => {
  try {
    const projectId = Number(c.req.param('projectId'));
    if (!Number.isFinite(projectId)) return c.json(badRequest('Invalid projectId'), 400);

    const body = (await c.req.json()) as {
      type?: string;
      service?: string;
      city?: string;
      customTitle?: string;
    };
    if (!body.type) return c.json(badRequest('type required'), 400);

    const project = await c.env.DB.prepare('SELECT state FROM projects WHERE id = ?')
      .bind(projectId)
      .first<{ state: string | null }>();
    if (!project) return c.json(notFound('Project'), 404);

    const state = (project.state ?? 'wi').toLowerCase();
    const slug =
      body.type === 'service-area' && body.service && body.city
        ? `/service-areas/${slugify(body.service)}-${slugify(body.city)}-${state}`
        : body.type === 'service' && body.service
          ? `/services/${slugify(body.service)}`
          : body.type === 'custom' && body.customTitle
            ? `/${slugify(body.customTitle)}`
            : `/${slugify(body.type)}`;

    // De-dupe on (project_id, type, service, city)
    const existing = await c.env.DB
      .prepare(
        `SELECT id FROM pages
         WHERE project_id = ? AND type = ?
           AND (service IS ? OR service = ?)
           AND (city IS ? OR city = ?)`
      )
      .bind(projectId, body.type, body.service ?? null, body.service ?? '', body.city ?? null, body.city ?? '')
      .first<{ id: number }>();
    if (existing) {
      const page = await c.env.DB.prepare('SELECT * FROM pages WHERE id = ?').bind(existing.id).first();
      return c.json(page, 200);
    }

    const insert = await c.env.DB
      .prepare(
        `INSERT INTO pages (project_id, type, service, city, slug, status, billing_status)
         VALUES (?, ?, ?, ?, ?, 'planned', 'included')`
      )
      .bind(
        projectId,
        body.type,
        body.service ?? body.customTitle ?? null,
        body.city ?? null,
        slug
      )
      .run();

    const page = await c.env.DB
      .prepare('SELECT * FROM pages WHERE id = ?')
      .bind(insert.meta.last_row_id)
      .first();
    return c.json(page, 201);
  } catch (err) {
    log('error', 'briefs', 'POST page failed', err);
    return c.json(serverError(`Page create failed: ${(err as Error).message}`), 500);
  }
});

// ============================================================================
// BRIEF FETCH / UPDATE
// ============================================================================

// GET /api/projects/:projectId/briefs — list all briefs (summary)
briefsRouter.get('/projects/:projectId/briefs', async (c) => {
  try {
    const projectId = Number(c.req.param('projectId'));
    if (!Number.isFinite(projectId)) return c.json(badRequest('Invalid projectId'), 400);

    const rows = await c.env.DB
      .prepare(
        `SELECT id, project_id, kind, page_id, status, version, tbd_count,
                generated_by_model, generated_at, updated_at, completed_at, supersedes_brief_id
         FROM briefs
         WHERE project_id = ?
         ORDER BY kind ASC, generated_at DESC`
      )
      .bind(projectId)
      .all();
    return c.json({ briefs: rows.results ?? [] });
  } catch (err) {
    log('error', 'briefs', 'GET project briefs failed', err);
    return c.json(serverError(), 500);
  }
});

// GET /api/briefs/:briefId — get a single brief (full markdown)
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

// PATCH /api/briefs/:briefId
// Body: { content_markdown: string }
// Used by the editor on inline TBD fill or freeform edits. Recounts tbd_count.
briefsRouter.patch('/briefs/:briefId', async (c) => {
  try {
    const briefId = Number(c.req.param('briefId'));
    if (!Number.isFinite(briefId)) return c.json(badRequest('Invalid briefId'), 400);

    const body = (await c.req.json()) as { content_markdown?: string };
    if (typeof body.content_markdown !== 'string') {
      return c.json(badRequest('content_markdown (string) required'), 400);
    }

    const existing = await c.env.DB
      .prepare('SELECT id FROM briefs WHERE id = ?')
      .bind(briefId)
      .first<{ id: number }>();
    if (!existing) return c.json(notFound('Brief'), 404);

    const tbds = countTbds(body.content_markdown);
    await c.env.DB
      .prepare(
        `UPDATE briefs
         SET content_markdown = ?, tbd_count = ?, updated_at = datetime('now')
         WHERE id = ?`
      )
      .bind(body.content_markdown, tbds, briefId)
      .run();

    const updated = await c.env.DB.prepare('SELECT * FROM briefs WHERE id = ?').bind(briefId).first<Brief>();
    return c.json(updated);
  } catch (err) {
    log('error', 'briefs', 'PATCH brief failed', err);
    return c.json(serverError(`Brief update failed: ${(err as Error).message}`), 500);
  }
});

// ============================================================================
// PAGE STATUS / BILLING
// ============================================================================

// PATCH /api/pages/:pageId/status — Body: { status: 'planned' | 'briefed' | 'complete' }
briefsRouter.patch('/pages/:pageId/status', async (c) => {
  try {
    const pageId = Number(c.req.param('pageId'));
    if (!Number.isFinite(pageId)) return c.json(badRequest('Invalid pageId'), 400);
    const body = (await c.req.json()) as { status?: string };
    const valid = ['planned', 'briefed', 'complete'];
    if (!body.status || !valid.includes(body.status)) {
      return c.json(badRequest(`status must be one of: ${valid.join(', ')}`), 400);
    }

    const page = await c.env.DB.prepare('SELECT id, project_id FROM pages WHERE id = ?').bind(pageId).first<{
      id: number; project_id: number;
    }>();
    if (!page) return c.json(notFound('Page'), 404);

    const setComplete = body.status === 'complete';
    await c.env.DB
      .prepare(
        `UPDATE pages
         SET status = ?,
             marked_complete_at = CASE WHEN ? = 1 THEN datetime('now') ELSE marked_complete_at END
         WHERE id = ?`
      )
      .bind(body.status, setComplete ? 1 : 0, pageId)
      .run();

    await c.env.DB
      .prepare(
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
    log('error', 'briefs', 'PATCH page status failed', err);
    return c.json(serverError(`Status update failed: ${(err as Error).message}`), 500);
  }
});

// PATCH /api/pages/:pageId/billing — Body: { billing_status: 'included' | 'add_on' | 'comp' }
briefsRouter.patch('/pages/:pageId/billing', async (c) => {
  try {
    const pageId = Number(c.req.param('pageId'));
    if (!Number.isFinite(pageId)) return c.json(badRequest('Invalid pageId'), 400);
    const body = (await c.req.json()) as { billing_status?: string };
    const valid = ['included', 'add_on', 'comp'];
    if (!body.billing_status || !valid.includes(body.billing_status)) {
      return c.json(badRequest(`billing_status must be one of: ${valid.join(', ')}`), 400);
    }

    const exists = await c.env.DB.prepare('SELECT id FROM pages WHERE id = ?').bind(pageId).first();
    if (!exists) return c.json(notFound('Page'), 404);

    await c.env.DB
      .prepare('UPDATE pages SET billing_status = ? WHERE id = ?')
      .bind(body.billing_status, pageId)
      .run();

    const updated = await c.env.DB.prepare('SELECT * FROM pages WHERE id = ?').bind(pageId).first();
    return c.json(updated);
  } catch (err) {
    log('error', 'briefs', 'PATCH page billing failed', err);
    return c.json(serverError(`Billing update failed: ${(err as Error).message}`), 500);
  }
});

// ============================================================================
// MATRIX
// ============================================================================

// GET /api/projects/:projectId/matrix
briefsRouter.get('/projects/:projectId/matrix', async (c) => {
  try {
    const projectId = Number(c.req.param('projectId'));
    if (!Number.isFinite(projectId)) return c.json(badRequest('Invalid projectId'), 400);

    const matrix = await buildMatrixForProject(c.env.DB, projectId);
    if (!matrix) return c.json(notFound('Project'), 404);
    return c.json(matrix);
  } catch (err) {
    log('error', 'briefs', 'GET matrix failed', err);
    return c.json(serverError(`Matrix build failed: ${(err as Error).message}`), 500);
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

  const ba = await env.DB
    .prepare('SELECT * FROM brand_attributes WHERE project_id = ? ORDER BY weight DESC, id ASC')
    .bind(projectId)
    .all<BrandAttribute>();

  const ts = await env.DB
    .prepare('SELECT * FROM testimonials WHERE project_id = ? ORDER BY is_featured DESC, id ASC')
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
      // Authoritative axes — the prompt enforces these as the source of
      // truth for Services Offered, Service Areas, and Site Structure.
      // The review-mined arrays go in the `mined` section as signal only.
      services: safeArr<string>(project.services),
      service_areas: safeArr<string>(project.service_areas),
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
  for (const raw of [project.reviews_snapshot, lead?.google_reviews]) {
    if (!raw) continue;
    try {
      const v = JSON.parse(raw);
      if (Array.isArray(v)) return v as GoogleReview[];
    } catch { /* ignore */ }
  }
  return [];
}

function collectMinedData(lead: Lead | null): MinedReviewData {
  const empty: MinedReviewData = {
    service_areas: [], services_performed: [], owner_names: [],
    strengths: [], local_landmarks: [], pitch_quotes: [],
  };
  if (!lead) return empty;
  return {
    services_performed: safeArr(lead.extracted_services),
    service_areas: safeArr(lead.extracted_service_areas),
    owner_names: safeArr(lead.owner_names),
    strengths: safeArr(lead.extracted_strengths),
    local_landmarks: safeArr(lead.extracted_local_landmarks),
    pitch_quotes: safeArr(lead.pitch_quotes),
  };
}

function pageSpecFromRow(page: {
  type: string;
  service: string | null;
  city: string | null;
}): PageSpec {
  // Page table uses 'service-area' (hyphenated) historically; pageBrief prompt uses 'service_area'
  const t = page.type === 'service-area' ? 'service_area' : page.type;
  switch (t) {
    case 'homepage':
    case 'about':
    case 'services_overview':
    case 'contact':
    case 'faq':
      return { type: t as PageType };
    case 'service':
      return { type: 'service', service: page.service ?? '' };
    case 'service_area':
      return { type: 'service_area', service: page.service ?? '', city: page.city ?? '' };
    case 'custom':
      return { type: 'custom', customTitle: page.service ?? `Page ${page.type}` };
    default:
      // Unknown legacy types — fall back to custom with the row's type label
      return { type: 'custom', customTitle: page.service ?? t };
  }
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

async function generateMasterBrief(
  env: Env,
  projectId: number,
  input: MasterBriefInput,
  version: number,
  feedback?: string,
): Promise<Brief> {
  const { system, user: baseUser } = buildMasterBriefPrompt(input);
  const user = feedback
    ? `${baseUser}\n\n## Operator feedback on the previous draft\n${feedback}\n\nIncorporate the feedback above when producing this revised draft.`
    : baseUser;

  const markdown = await callClaude(env.CLAUDE_API_KEY, user, {
    model: BRIEF_MODEL,
    systemPrompt: system,
    cacheSystem: true,
    maxTokens: 8000,
    temperature: 0.4,
    timeoutMs: 90_000,
  });

  const tbds = countTbds(markdown);

  const insert = await env.DB
    .prepare(
      `INSERT INTO briefs
         (project_id, kind, content_markdown, status, version, tbd_count,
          generated_by_model, generation_input, updated_at)
       VALUES (?, 'master', ?, 'saved', ?, ?, ?, ?, datetime('now'))`
    )
    .bind(projectId, markdown, version, tbds, BRIEF_MODEL, JSON.stringify({ input }))
    .run();

  const briefId = insert.meta.last_row_id as number;
  const brief = await env.DB.prepare('SELECT * FROM briefs WHERE id = ?').bind(briefId).first<Brief>();
  if (!brief) throw new Error('Brief insert succeeded but row not found');
  return brief;
}
