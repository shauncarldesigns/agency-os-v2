import { Hono } from 'hono';
import type { Env } from '../types';
import { badRequest, conflict, notFound, serverError, log } from '../utils/errors';
import { chicagoToday } from '../services/dayOfWeek';
import { callClaude, callClaudeJson } from '../services/claude';

export const growthCyclesRouter = new Hono<{ Bindings: Env }>();

const phases = ['foundation', 'expansion', 'optimization'] as const;
const categories = ['created', 'improved', 'google_business', 'proof', 'measured', 'technical', 'conversion'] as const;
const itemStatuses = ['planned', 'in_progress', 'complete', 'blocked'] as const;
const planningModes = ['auto', 'balanced', 'expansion', 'optimization'] as const;
const BRIEF_MODEL = 'claude-opus-4-7';

function currentPeriod() { return chicagoToday().slice(0, 7); }
function dueDate(period: string) {
  const [year, month] = period.split('-').map(Number);
  if (!year || !month || month < 1 || month > 12) return null;
  const day = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${period}-${String(day).padStart(2, '0')}`;
}
function stringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (typeof value !== 'string' || !value.trim()) return [];
  try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : []; }
  catch { return value.split(',').map((part) => part.trim()).filter(Boolean); }
}

async function cycleDetail(db: D1Database, id: number) {
  const cycle = await db.prepare('SELECT * FROM growth_cycles WHERE id = ?').bind(id).first();
  if (!cycle) return null;
  const items = await db.prepare('SELECT * FROM growth_work_items WHERE cycle_id = ? ORDER BY created_at ASC, id ASC').bind(id).all();
  return { cycle, items: items.results };
}

growthCyclesRouter.get('/projects/:id/growth-cycles/current', async (c) => {
  const projectId = Number(c.req.param('id'));
  if (!Number.isFinite(projectId)) return c.json(badRequest('Invalid project id'), 400);
  const cycle = await c.env.DB.prepare('SELECT id FROM growth_cycles WHERE project_id = ? AND period = ?')
    .bind(projectId, currentPeriod()).first<{ id: number }>();
  if (!cycle) return c.json({ cycle: null, items: [] });
  // Reconcile recommendations with pages materialized through either the
  // queue or the Matrix. This also repairs older rows created before the
  // direct linking behavior existed.
  await c.env.DB.prepare(`UPDATE growth_work_items
    SET page_id = (SELECT p.id FROM pages p JOIN growth_cycles gc ON gc.project_id=p.project_id
      WHERE gc.id=growth_work_items.cycle_id
        AND p.type=growth_work_items.recommended_page_type
        AND COALESCE(p.service,'')=COALESCE(growth_work_items.recommended_service,'')
        AND COALESCE(p.city,'')=COALESCE(growth_work_items.recommended_city,'') LIMIT 1),
        status = 'in_progress', updated_at=datetime('now')
    WHERE cycle_id=? AND page_id IS NULL AND recommended_page_type IS NOT NULL
      AND EXISTS (SELECT 1 FROM pages p JOIN growth_cycles gc ON gc.project_id=p.project_id
        WHERE gc.id=growth_work_items.cycle_id
          AND p.type=growth_work_items.recommended_page_type
          AND COALESCE(p.service,'')=COALESCE(growth_work_items.recommended_service,'')
          AND COALESCE(p.city,'')=COALESCE(growth_work_items.recommended_city,''))`).bind(cycle.id).run();
  // A live page only completes page-creation work. Optimization items can
  // intentionally reference an existing live page and still require work.
  await c.env.DB.prepare(`UPDATE growth_work_items SET status='complete', completed_at=COALESCE(completed_at, datetime('now')), updated_at=datetime('now') WHERE cycle_id=? AND category='created' AND page_id IN (SELECT id FROM pages WHERE status='complete')`).bind(cycle.id).run();
  await c.env.DB.prepare(`UPDATE growth_work_items SET status='complete', completed_at=COALESCE(completed_at, datetime('now')), updated_at=datetime('now')
    WHERE cycle_id=? AND status!='complete' AND (
      (completion_signal='gsc_connected' AND EXISTS (SELECT 1 FROM projects WHERE id=? AND gsc_property_url IS NOT NULL AND trim(gsc_property_url)!=''))
      OR (completion_signal='seo_snapshot_available' AND EXISTS (SELECT 1 FROM seo_snapshots WHERE project_id=?))
    )`).bind(cycle.id, projectId, projectId).run();
  return c.json(await cycleDetail(c.env.DB, cycle.id));
});

growthCyclesRouter.get('/projects/:id/growth-strategy', async (c) => {
  const projectId = Number(c.req.param('id'));
  const project = await c.env.DB.prepare('SELECT id FROM projects WHERE id = ?').bind(projectId).first();
  if (!project) return c.json(notFound('Project'), 404);
  const strategy = await c.env.DB.prepare('SELECT * FROM growth_strategies WHERE project_id = ?').bind(projectId).first();
  return c.json({ strategy: strategy ?? { project_id: projectId, planning_mode: 'auto', primary_objective: null, priority_services: '[]', priority_areas: '[]', seasonal_priorities: null, constraints: null, auto_generate: 0, require_approval: 1 } });
});

growthCyclesRouter.put('/projects/:id/growth-strategy', async (c) => {
  const projectId = Number(c.req.param('id'));
  const project = await c.env.DB.prepare('SELECT id FROM projects WHERE id = ?').bind(projectId).first();
  if (!project) return c.json(notFound('Project'), 404);
  const body = await c.req.json() as { planning_mode?: string; primary_objective?: string; priority_services?: string[]; priority_areas?: string[]; seasonal_priorities?: string; constraints?: string; auto_generate?: boolean; require_approval?: boolean };
  if (body.planning_mode && !planningModes.includes(body.planning_mode as typeof planningModes[number])) return c.json(badRequest('Invalid planning mode'), 400);
  await c.env.DB.prepare(`INSERT INTO growth_strategies (project_id, planning_mode, primary_objective, priority_services, priority_areas, seasonal_priorities, constraints, auto_generate, require_approval)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(project_id) DO UPDATE SET planning_mode=excluded.planning_mode, primary_objective=excluded.primary_objective, priority_services=excluded.priority_services, priority_areas=excluded.priority_areas, seasonal_priorities=excluded.seasonal_priorities, constraints=excluded.constraints, auto_generate=excluded.auto_generate, require_approval=excluded.require_approval, updated_at=datetime('now')`)
    .bind(projectId, body.planning_mode ?? 'auto', body.primary_objective?.trim() || null, JSON.stringify(body.priority_services ?? []), JSON.stringify(body.priority_areas ?? []), body.seasonal_priorities?.trim() || null, body.constraints?.trim() || null, body.auto_generate ? 1 : 0, body.require_approval === false ? 0 : 1).run();
  const strategy = await c.env.DB.prepare('SELECT * FROM growth_strategies WHERE project_id = ?').bind(projectId).first();
  return c.json({ strategy });
});

growthCyclesRouter.post('/projects/:id/growth-cycles', async (c) => {
  try {
    const projectId = Number(c.req.param('id'));
    const project = await c.env.DB.prepare('SELECT id, tier FROM projects WHERE id = ?').bind(projectId).first<{ id: number; tier: number }>();
    if (!project) return c.json(notFound('Project'), 404);
    if (project.tier !== 3) return c.json(badRequest('Growth cycles are available for Growth clients'), 400);
    const body = await c.req.json().catch(() => ({})) as { period?: string; phase?: string };
    const period = body.period ?? currentPeriod();
    const due = dueDate(period);
    if (!due) return c.json(badRequest('period must be YYYY-MM'), 400);
    const phase = phases.includes(body.phase as typeof phases[number]) ? body.phase! : 'expansion';
    const existing = await c.env.DB.prepare('SELECT id FROM growth_cycles WHERE project_id = ? AND period = ?').bind(projectId, period).first();
    if (existing) return c.json(conflict('A growth cycle already exists for this month'), 409);
    const result = await c.env.DB.prepare(
      `INSERT INTO growth_cycles (project_id, period, phase, due_date) VALUES (?, ?, ?, ?)`
    ).bind(projectId, period, phase, due).run();
    return c.json(await cycleDetail(c.env.DB, Number(result.meta.last_row_id)), 201);
  } catch (err) {
    log('error', 'growth-cycles', 'Create cycle failed', err);
    return c.json(serverError((err as Error).message), 500);
  }
});

growthCyclesRouter.post('/projects/:id/growth-cycles/generate', async (c) => {
  try {
    const projectId = Number(c.req.param('id'));
    const body = await c.req.json().catch(() => ({})) as { replace?: boolean };
    const project = await c.env.DB.prepare('SELECT * FROM projects WHERE id = ?').bind(projectId).first<Record<string, unknown>>();
    if (!project) return c.json(notFound('Project'), 404);
    if (Number(project.tier) !== 3) return c.json(badRequest('Growth plans can only be generated for Growth clients'), 400);
    const period = currentPeriod();
    let cycle = await c.env.DB.prepare('SELECT * FROM growth_cycles WHERE project_id = ? AND period = ?').bind(projectId, period).first<Record<string, unknown>>();
    if (!cycle) {
      const inserted = await c.env.DB.prepare('INSERT INTO growth_cycles (project_id, period, phase, due_date) VALUES (?, ?, ?, ?)').bind(projectId, period, 'expansion', dueDate(period)).run();
      cycle = await c.env.DB.prepare('SELECT * FROM growth_cycles WHERE id = ?').bind(inserted.meta.last_row_id).first<Record<string, unknown>>();
    }
    const existing = await c.env.DB.prepare('SELECT COUNT(*) AS count FROM growth_work_items WHERE cycle_id = ?').bind(cycle!.id).first<{ count: number }>();
    if ((existing?.count ?? 0) > 0 && !body.replace) return c.json(conflict('This cycle already has priorities. Regenerate with replace enabled.'), 409);
    if (body.replace && cycle!.status !== 'planning') return c.json(conflict('Only a draft cycle can be regenerated'), 409);

    const [strategy, pages, snapshot, previousCycle] = await Promise.all([
      c.env.DB.prepare('SELECT * FROM growth_strategies WHERE project_id = ?').bind(projectId).first<Record<string, unknown>>(),
      c.env.DB.prepare("SELECT id, type, service, city, title, published_url, status FROM pages WHERE project_id = ? ORDER BY type, service, city").bind(projectId).all(),
      c.env.DB.prepare('SELECT period, impressions, clicks, avg_position, ctr, pagespeed_desktop, pagespeed_mobile, top_keywords, top_pages FROM seo_snapshots WHERE project_id = ? ORDER BY period DESC LIMIT 1').bind(projectId).first(),
      c.env.DB.prepare(`SELECT gc.period, gc.next_priorities, group_concat(gwi.title, ' | ') AS completed_work FROM growth_cycles gc LEFT JOIN growth_work_items gwi ON gwi.cycle_id=gc.id AND gwi.status='complete' WHERE gc.project_id=? AND gc.period < ? GROUP BY gc.id ORDER BY gc.period DESC LIMIT 1`).bind(projectId, period).first(),
    ]);
    const existingSpecs = new Set(pages.results.map((page) => {
      const p = page as { type: string; service?: string | null; city?: string | null };
      return `${p.type}|${p.service ?? ''}|${p.city ?? ''}`.toLowerCase();
    }));
    const services = stringList(project.services);
    const areas = stringList(project.service_areas);
    const pageCandidates = [
      ...services.map((service) => ({ type: 'service', service, city: null })),
      ...services.flatMap((service) => areas.map((city) => ({ type: 'service-area', service, city }))),
    ].filter((candidate) => !existingSpecs.has(`${candidate.type}|${candidate.service}|${candidate.city ?? ''}`.toLowerCase()));
    const prompt = `Create a practical monthly managed-growth plan for this local-service client. Return JSON only as {"phase":"foundation|expansion|optimization","summary":"one sentence","items":[{"category":"created|measured","title":"specific operator task","description":"why this matters and the evidence used","page_id":number|null,"recommended_page":{"type":"service|service-area","service":"exact candidate service","city":"exact candidate city or null"}|null,"completion_signal":"gsc_connected|seo_snapshot_available"|null}]}. Produce up to 5 items. Every item must be automatically verifiable. For every created item, choose an exact object from AVAILABLE MISSING PAGES and return it as recommended_page. A measured item is allowed only when Search Console needs connecting (completion_signal gsc_connected) or no SEO snapshot exists (completion_signal seo_snapshot_available). Never recommend Google Business, proof, technical, conversion, or generic optimization work because those integrations do not yet provide a reliable completion signal. Never invent rankings, services, locations, projects, reviews, or activity. If no missing page is strategically justified, do not create a page item.

PROJECT: ${JSON.stringify({ business_name: project.business_name, industry: project.industry, city: project.city, state: project.state, services: project.services, service_areas: project.service_areas, reviews_snapshot: project.reviews_snapshot })}
STRATEGY: ${JSON.stringify(strategy ?? { planning_mode: 'auto' })}
PAGE INVENTORY: ${JSON.stringify(pages.results)}
AVAILABLE MISSING PAGES: ${JSON.stringify(pageCandidates)}
LATEST SEO SNAPSHOT: ${JSON.stringify(snapshot ?? null)}
PREVIOUS CYCLE: ${JSON.stringify(previousCycle ?? null)}`;
    const generated = await callClaudeJson<{ phase: string; summary: string; items: Array<{ category: string; title: string; description?: string; page_id?: number | null; recommended_page?: { type: string; service: string; city?: string | null } | null; completion_signal?: string | null }> }>(c.env.CLAUDE_API_KEY, prompt, { maxTokens: 1800, temperature: 0.2 });
    const supportedSignals = new Set(['gsc_connected', 'seo_snapshot_available']);
    const validItems = (generated.items ?? []).filter((item) => item.title?.trim() && (item.category === 'created' || (item.category === 'measured' && supportedSignals.has(item.completion_signal ?? '')))).slice(0, 5);
    const phase = phases.includes(generated.phase as typeof phases[number]) ? generated.phase : 'optimization';
    const statements = [c.env.DB.prepare('DELETE FROM growth_work_items WHERE cycle_id = ?').bind(cycle!.id)];
    const validPageIds = new Set(pages.results.map((page) => Number((page as { id: number }).id)));
    const candidateByKey = new Map(pageCandidates.map((candidate) => [`${candidate.type}|${candidate.service}|${candidate.city ?? ''}`.toLowerCase(), candidate]));
    for (const item of validItems) {
      const requested = item.recommended_page;
      const candidate = requested ? candidateByKey.get(`${requested.type}|${requested.service}|${requested.city ?? ''}`.toLowerCase()) : undefined;
      if (item.category === 'created' && !candidate) continue;
      statements.push(c.env.DB.prepare('INSERT INTO growth_work_items (cycle_id, category, title, description, page_id, recommended_page_type, recommended_service, recommended_city, completion_signal) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(cycle!.id, item.category, item.title.trim(), item.description?.trim() || null, item.page_id && validPageIds.has(Number(item.page_id)) ? Number(item.page_id) : null, candidate?.type ?? null, candidate?.service ?? null, candidate?.city ?? null, item.category === 'measured' ? item.completion_signal : null));
    }
    statements.push(c.env.DB.prepare(`UPDATE growth_cycles SET phase=?, status='planning', generated_at=datetime('now'), generated_by='claude', updated_at=datetime('now') WHERE id=?`).bind(phase, cycle!.id));
    await c.env.DB.batch(statements);
    return c.json(await cycleDetail(c.env.DB, Number(cycle!.id)));
  } catch (err) {
    log('error', 'growth-cycles', 'Generate plan failed', err);
    return c.json(serverError(`Plan generation failed: ${(err as Error).message}`), 500);
  }
});

growthCyclesRouter.patch('/growth-cycles/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const body = await c.req.json() as { phase?: string; status?: string; client_summary?: string | null; next_priorities?: string | null };
  if (body.phase && !phases.includes(body.phase as typeof phases[number])) return c.json(badRequest('Invalid phase'), 400);
  if (body.status && !['planning', 'active', 'complete'].includes(body.status)) return c.json(badRequest('Invalid status'), 400);
  const current = await c.env.DB.prepare('SELECT * FROM growth_cycles WHERE id = ?').bind(id).first<Record<string, unknown>>();
  if (!current) return c.json(notFound('Growth cycle'), 404);
  const status = body.status ?? String(current.status);
  await c.env.DB.prepare(`UPDATE growth_cycles SET phase = ?, status = ?, client_summary = ?, next_priorities = ?, completed_at = CASE WHEN ? = 'complete' THEN COALESCE(completed_at, datetime('now')) ELSE NULL END, updated_at = datetime('now') WHERE id = ?`)
    .bind(body.phase ?? current.phase, status, body.client_summary === undefined ? current.client_summary : body.client_summary, body.next_priorities === undefined ? current.next_priorities : body.next_priorities, status, id).run();
  return c.json(await cycleDetail(c.env.DB, id));
});

growthCyclesRouter.post('/growth-cycles/:id/items', async (c) => {
  const cycleId = Number(c.req.param('id'));
  const cycle = await c.env.DB.prepare('SELECT id FROM growth_cycles WHERE id = ?').bind(cycleId).first();
  if (!cycle) return c.json(notFound('Growth cycle'), 404);
  const body = await c.req.json() as { category?: string; title?: string; description?: string; evidence_url?: string; page_id?: number; recommended_page_type?: string; recommended_service?: string; recommended_city?: string };
  if (!categories.includes(body.category as typeof categories[number])) return c.json(badRequest('Invalid category'), 400);
  if (!body.title?.trim()) return c.json(badRequest('Title is required'), 400);
  const result = await c.env.DB.prepare(`INSERT INTO growth_work_items (cycle_id, category, title, description, evidence_url, page_id, recommended_page_type, recommended_service, recommended_city) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(cycleId, body.category, body.title.trim(), body.description?.trim() || null, body.evidence_url?.trim() || null, body.page_id ?? null, body.recommended_page_type ?? null, body.recommended_service ?? null, body.recommended_city ?? null).run();
  const item = await c.env.DB.prepare('SELECT * FROM growth_work_items WHERE id = ?').bind(result.meta.last_row_id).first();
  return c.json({ item }, 201);
});

growthCyclesRouter.patch('/growth-work-items/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const current = await c.env.DB.prepare('SELECT * FROM growth_work_items WHERE id = ?').bind(id).first<Record<string, unknown>>();
  if (!current) return c.json(notFound('Growth work item'), 404);
  const body = await c.req.json() as { status?: string; title?: string; description?: string | null; evidence_url?: string | null; client_visible?: boolean };
  if (body.status && !itemStatuses.includes(body.status as typeof itemStatuses[number])) return c.json(badRequest('Invalid status'), 400);
  const status = body.status ?? String(current.status);
  await c.env.DB.prepare(`UPDATE growth_work_items SET title = ?, description = ?, evidence_url = ?, client_visible = ?, status = ?, completed_at = CASE WHEN ? = 'complete' THEN COALESCE(completed_at, datetime('now')) ELSE NULL END, updated_at = datetime('now') WHERE id = ?`)
    .bind(body.title?.trim() || current.title, body.description === undefined ? current.description : body.description, body.evidence_url === undefined ? current.evidence_url : body.evidence_url, body.client_visible === undefined ? current.client_visible : (body.client_visible ? 1 : 0), status, status, id).run();
  const item = await c.env.DB.prepare('SELECT * FROM growth_work_items WHERE id = ?').bind(id).first();
  return c.json({ item });
});

growthCyclesRouter.post('/growth-work-items/:id/brief', async (c) => {
  try {
    const id = Number(c.req.param('id'));
    if (!Number.isFinite(id)) return c.json(badRequest('Invalid work item id'), 400);
    const item = await c.env.DB.prepare(`SELECT gwi.*, gc.project_id, gc.period, p.business_name, p.industry, p.services, p.service_areas
      FROM growth_work_items gwi JOIN growth_cycles gc ON gc.id=gwi.cycle_id JOIN projects p ON p.id=gc.project_id
      WHERE gwi.id=?`).bind(id).first<Record<string, unknown>>();
    if (!item) return c.json(notFound('Growth work item'), 404);
    if (String(item.category) === 'created') return c.json(badRequest('Use page brief generation for new-page work'), 400);
    if (!item.page_id) return c.json(badRequest('This recommendation is not linked to a website page'), 400);
    if (item.brief_id) {
      const existing = await c.env.DB.prepare('SELECT * FROM briefs WHERE id=?').bind(item.brief_id).first();
      if (existing) return c.json({ brief: existing, item });
    }

    const [page, master, previousBrief, snapshot] = await Promise.all([
      c.env.DB.prepare('SELECT * FROM pages WHERE id=? AND project_id=?').bind(item.page_id, item.project_id).first<Record<string, unknown>>(),
      c.env.DB.prepare("SELECT content_markdown FROM briefs WHERE project_id=? AND kind='master' AND supersedes_brief_id IS NULL").bind(item.project_id).first<{ content_markdown: string }>(),
      c.env.DB.prepare("SELECT * FROM briefs WHERE project_id=? AND page_id=? AND kind='page' ORDER BY version DESC, id DESC LIMIT 1").bind(item.project_id, item.page_id).first<Record<string, unknown>>(),
      c.env.DB.prepare('SELECT * FROM seo_snapshots WHERE project_id=? ORDER BY period DESC LIMIT 1').bind(item.project_id).first(),
    ]);
    if (!page) return c.json(notFound('Page'), 404);

    const prompt = `Write an actionable update brief for an existing live local-service website page. This is not a replacement page and must not invent performance data. Tell the builder exactly what to retain, change, add, and verify. Include a short success checklist. Use the recommendation and available evidence as the reason for every change.

CLIENT: ${JSON.stringify({ business_name: item.business_name, industry: item.industry, services: item.services, service_areas: item.service_areas })}
LIVE PAGE: ${JSON.stringify(page)}
OPTIMIZATION RECOMMENDATION: ${JSON.stringify({ title: item.title, description: item.description, category: item.category, evidence_url: item.evidence_url })}
LATEST SEO SNAPSHOT: ${JSON.stringify(snapshot ?? null)}
CURRENT PAGE BRIEF: ${String(previousBrief?.content_markdown ?? 'No prior page brief is available.')}
MASTER BRIEF: ${master?.content_markdown ?? 'No master brief exists because this live site was imported. Use the project configuration, live page record, audit evidence, and prior page brief only.'}`;
    const markdown = await callClaude(c.env.CLAUDE_API_KEY, prompt, {
      model: BRIEF_MODEL, maxTokens: 4000, temperature: 0.4, timeoutMs: 90_000,
      systemPrompt: 'You are a senior local SEO and conversion strategist. Produce a concise implementation brief in Markdown for updating an existing page. Separate evidence from assumptions and never fabricate metrics.',
      cacheSystem: true,
    });
    const version = Number(previousBrief?.version ?? 0) + 1;
    const inserted = await c.env.DB.prepare(`INSERT INTO briefs
      (project_id, kind, page_id, content_markdown, status, version, tbd_count, generated_by_model, generation_input, updated_at, supersedes_brief_id)
      VALUES (?, 'page', ?, ?, 'briefed', ?, 0, ?, ?, datetime('now'), ?)`)
      .bind(item.project_id, item.page_id, markdown, version, BRIEF_MODEL, JSON.stringify({ growth_work_item_id: id }), previousBrief?.id ?? null).run();
    await c.env.DB.prepare("UPDATE growth_work_items SET brief_id=?, status='in_progress', updated_at=datetime('now') WHERE id=?")
      .bind(inserted.meta.last_row_id, id).run();
    const [brief, updatedItem] = await Promise.all([
      c.env.DB.prepare('SELECT * FROM briefs WHERE id=?').bind(inserted.meta.last_row_id).first(),
      c.env.DB.prepare('SELECT * FROM growth_work_items WHERE id=?').bind(id).first(),
    ]);
    return c.json({ brief, item: updatedItem }, 201);
  } catch (err) {
    log('error', 'growth-cycles', 'Generate optimization brief failed', err);
    return c.json(serverError(`Optimization brief generation failed: ${(err as Error).message}`), 500);
  }
});

growthCyclesRouter.delete('/growth-work-items/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const result = await c.env.DB.prepare('DELETE FROM growth_work_items WHERE id = ?').bind(id).run();
  if (!result.meta.changes) return c.json(notFound('Growth work item'), 404);
  return c.json({ success: true });
});
