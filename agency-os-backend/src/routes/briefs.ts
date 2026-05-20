import { Hono } from 'hono';
import type { Env, Project, Lead } from '../types';
import { badRequest, notFound, serverError, log } from '../utils/errors';
import { callClaude } from '../services/claude';
import { buildSiteBriefPrompt, type SiteBriefInput } from '../prompts/siteBrief';
import { buildPageBriefPrompt } from '../prompts/pageBrief';

export const briefsRouter = new Hono<{ Bindings: Env }>();

interface PitchQuote { author: string; location?: string; quote: string; why?: string }

briefsRouter.post('/generate', async (c) => {
  try {
    const body = await c.req.json() as {
      projectId?: number;
      leadId?: number;
      tier?: 1 | 2 | 3;
      type?: 'initial' | 'add-page';
      page?: { type: string; service?: string; city?: string };
    };
    const briefType = body.type ?? 'initial';

    // Source data: prefer existing project; fall back to lead
    let project: Project | null = null;
    let lead: Lead | null = null;
    if (body.projectId) {
      project = await c.env.DB.prepare('SELECT * FROM projects WHERE id = ?').bind(body.projectId).first<Project>();
      if (!project) return c.json(notFound('Project'), 404);
    } else if (body.leadId) {
      lead = await c.env.DB.prepare('SELECT * FROM leads WHERE id = ?').bind(body.leadId).first<Lead>();
      if (!lead) return c.json(notFound('Lead'), 404);
    } else {
      return c.json(badRequest('projectId or leadId required'), 400);
    }

    const tier = (body.tier
      ?? (project?.tier as 1 | 2 | 3 | undefined)
      ?? (lead?.recommended_tier as 1 | 2 | 3 | undefined)
      ?? 1) as 1 | 2 | 3;

    if (briefType === 'add-page') {
      if (!project) return c.json(badRequest('add-page brief requires projectId'), 400);
      if (!body.page) return c.json(badRequest('page descriptor required for add-page brief'), 400);
      const markdown = buildPageBriefPrompt({
        businessName: project.business_name,
        phone: project.phone,
        state: project.state,
        brandVoiceNotes: project.brand_voice_notes,
        pageType: body.page.type as 'homepage' | 'service' | 'service-area' | 'about' | 'faq' | 'contact',
        service: body.page.service,
        city: body.page.city,
        serviceAreas: safeParseArray(project.service_areas),
      });
      return c.json({ markdown, source: 'template' });
    }

    // Initial-build brief: use Claude to render the master template with mined data
    const input = buildInputFromProjectOrLead({ project, lead, tier });
    const prompt = buildSiteBriefPrompt(input);

    const markdown = await callClaude(c.env.CLAUDE_API_KEY, prompt, {
      maxTokens: 3000,
      temperature: 0.4,
    });

    return c.json({ markdown, source: 'claude', input });
  } catch (err) {
    log('error', 'briefs', 'POST /briefs/generate failed', err);
    return c.json(serverError(`Brief generation failed: ${(err as Error).message}`), 500);
  }
});

briefsRouter.post('/queue', async (c) => {
  try {
    const body = await c.req.json() as {
      projectId: number;
      briefMarkdown: string;
      jobType?: 'initial-build' | 'add-page';
      pageId?: number;
    };
    if (!body.projectId) return c.json(badRequest('projectId required'), 400);
    if (!body.briefMarkdown) return c.json(badRequest('briefMarkdown required'), 400);

    const project = await c.env.DB.prepare('SELECT id, business_name FROM projects WHERE id = ?').bind(body.projectId).first<Project>();
    if (!project) return c.json(notFound('Project'), 404);

    const insertResult = await c.env.DB.prepare(
      `INSERT INTO brief_jobs (project_id, page_id, job_type, brief_markdown, status)
       VALUES (?, ?, ?, ?, 'queued')`
    ).bind(
      body.projectId,
      body.pageId ?? null,
      body.jobType ?? 'initial-build',
      body.briefMarkdown,
    ).run();

    const jobId = insertResult.meta.last_row_id;

    // Send to Cloudflare Queue (Cowork worker pulls from this).
    // For local dev (manual handoff first), the queue may not be wired — log and continue.
    try {
      await c.env.BRIEF_QUEUE.send({
        jobId: jobId as number,
        projectId: body.projectId,
        pageId: body.pageId,
        jobType: body.jobType ?? 'initial-build',
        briefMarkdown: body.briefMarkdown,
      });
    } catch (err) {
      log('warn', 'briefs', `Queue send failed for job ${jobId} (manual handoff fallback)`, err);
    }

    log('info', 'briefs', `Job ${jobId} queued for project ${body.projectId}`, { type: body.jobType });
    return c.json({ jobId, status: 'queued' }, 201);
  } catch (err) {
    log('error', 'briefs', 'POST /briefs/queue failed', err);
    return c.json(serverError(), 500);
  }
});

briefsRouter.get('/queue/status', async (c) => {
  try {
    const all = await c.env.DB.prepare(`
      SELECT bj.id, bj.project_id, bj.page_id, bj.job_type, bj.status,
             bj.cowork_started_at, bj.cowork_completed_at, bj.error_message, bj.created_at,
             p.business_name AS project_name, p.tier AS project_tier
      FROM brief_jobs bj
      LEFT JOIN projects p ON p.id = bj.project_id
      WHERE bj.status IN ('queued', 'processing')
      ORDER BY bj.created_at ASC
      LIMIT 50
    `).all();

    const recent = await c.env.DB.prepare(`
      SELECT bj.id, bj.project_id, bj.status, bj.cowork_completed_at, bj.error_message,
             p.business_name AS project_name
      FROM brief_jobs bj
      LEFT JOIN projects p ON p.id = bj.project_id
      WHERE bj.status IN ('done', 'failed')
      ORDER BY bj.cowork_completed_at DESC
      LIMIT 10
    `).all();

    const counts = {
      queued: (all.results as Array<{ status: string }>).filter(j => j.status === 'queued').length,
      processing: (all.results as Array<{ status: string }>).filter(j => j.status === 'processing').length,
    };
    return c.json({ active: all.results, recent: recent.results, counts });
  } catch (err) {
    log('error', 'briefs', 'GET /briefs/queue/status failed', err);
    return c.json(serverError(), 500);
  }
});

// --- Helpers ---

function buildInputFromProjectOrLead({ project, lead, tier }: { project: Project | null; lead: Lead | null; tier: 1 | 2 | 3 }): SiteBriefInput {
  if (project) {
    return {
      businessName: project.business_name,
      phone: project.phone,
      city: project.city,
      state: project.state,
      yearsInBusiness: project.years_in_business,
      ownerName: null,
      industry: project.industry,
      description: project.description,
      brandVoiceNotes: project.brand_voice_notes,
      services: safeParseArray(project.services),
      serviceAreas: safeParseArray(project.service_areas),
      pitchQuotes: [],
      strengths: [],
      tier,
    };
  }
  if (!lead) throw new Error('No source provided');
  const ownerNames = safeParseArray(lead.owner_names);
  return {
    businessName: lead.company,
    phone: lead.phone,
    city: lead.city,
    state: lead.state,
    yearsInBusiness: null,
    ownerName: ownerNames[0] ?? null,
    industry: lead.industry,
    description: null,
    brandVoiceNotes: null,
    services: safeParseArray(lead.extracted_services),
    serviceAreas: safeParseArray(lead.extracted_service_areas),
    pitchQuotes: safeParseArray<PitchQuote>(lead.pitch_quotes).map(q => ({
      author: q.author, location: q.location, quote: q.quote,
    })),
    strengths: safeParseArray(lead.extracted_strengths),
    tier,
  };
}

function safeParseArray<T = string>(raw: string | null | undefined): T[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v as T[] : [];
  } catch { return []; }
}
