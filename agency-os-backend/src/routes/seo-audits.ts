import { Hono } from 'hono';
import type { Env, Project } from '../types';
import { badRequest, notFound, serverError } from '../utils/errors';
import { createAuditWorkForRun, runSeoAudit } from '../services/seoAudit';

export const seoAuditsRouter = new Hono<{ Bindings: Env }>();

seoAuditsRouter.get('/projects/:id/seo-audits/latest', async (c) => {
  const projectId = Number(c.req.param('id'));
  if (!Number.isFinite(projectId)) return c.json(badRequest('Invalid project id'), 400);
  const run = await c.env.DB.prepare('SELECT * FROM seo_audit_runs WHERE project_id=? ORDER BY id DESC LIMIT 1').bind(projectId).first();
  if (!run) return c.json({ run: null, findings: [] });
  const findings = await c.env.DB.prepare(`SELECT * FROM seo_audit_findings WHERE run_id=?
    ORDER BY CASE severity WHEN 'critical' THEN 1 WHEN 'warning' THEN 2 ELSE 3 END, page_url, rule_key`).bind(run.id).all();
  const unmatched = await c.env.DB.prepare('SELECT COUNT(*) AS count FROM seo_audit_pages WHERE run_id=? AND page_id IS NULL AND status_code BETWEEN 200 AND 399').bind(run.id).first<{ count: number }>();
  return c.json({ run, findings: findings.results, unmatchedPages: unmatched?.count ?? 0 });
});

seoAuditsRouter.post('/projects/:id/seo-audits', async (c) => {
  const projectId = Number(c.req.param('id'));
  if (!Number.isFinite(projectId)) return c.json(badRequest('Invalid project id'), 400);
  const project = await c.env.DB.prepare('SELECT * FROM projects WHERE id=?').bind(projectId).first<Project>();
  if (!project) return c.json(notFound('Project'), 404);
  if (project.status !== 'live') return c.json(badRequest('SEO audits can only run for live sites'), 400);
  try {
    const run = await runSeoAudit(c.env, project);
    const findings = await c.env.DB.prepare(`SELECT * FROM seo_audit_findings WHERE run_id=?
      ORDER BY CASE severity WHEN 'critical' THEN 1 WHEN 'warning' THEN 2 ELSE 3 END, page_url, rule_key`).bind(run.id).all();
    const unmatched = await c.env.DB.prepare('SELECT COUNT(*) AS count FROM seo_audit_pages WHERE run_id=? AND page_id IS NULL AND status_code BETWEEN 200 AND 399').bind(run.id).first<{ count: number }>();
    return c.json({ run, findings: findings.results, unmatchedPages: unmatched?.count ?? 0 }, 201);
  } catch (error) {
    return c.json(serverError(`SEO audit failed: ${error instanceof Error ? error.message : String(error)}`), 500);
  }
});

seoAuditsRouter.post('/projects/:id/seo-audits/import-pages', async (c) => {
  const projectId = Number(c.req.param('id'));
  if (!Number.isFinite(projectId)) return c.json(badRequest('Invalid project id'), 400);
  const project = await c.env.DB.prepare('SELECT * FROM projects WHERE id=?').bind(projectId).first<Project>();
  if (!project) return c.json(notFound('Project'), 404);
  const run = await c.env.DB.prepare("SELECT id FROM seo_audit_runs WHERE project_id=? AND status='complete' ORDER BY id DESC LIMIT 1").bind(projectId).first<{ id: number }>();
  if (!run) return c.json(badRequest('Run an SEO audit before importing pages'), 400);
  const auditPages = await c.env.DB.prepare(`SELECT * FROM seo_audit_pages WHERE run_id=? AND page_id IS NULL AND status_code BETWEEN 200 AND 399 ORDER BY url`).bind(run.id).all<Record<string, unknown>>();
  const services = parseList(project.services);
  let imported = 0;
  for (const auditPage of auditPages.results ?? []) {
    const url = String(auditPage.url);
    const path = new URL(url).pathname.replace(/\/+$/, '') || '/';
    const classification = classifyImportedPage(path, String(auditPage.title ?? ''), services);
    const existing = await findExistingPage(c.env.DB, projectId, classification, path);
    let pageId = existing?.id;
    if (pageId) {
      await c.env.DB.prepare(`UPDATE pages SET status='complete', slug=?, published_url=?, url=?, title=COALESCE(NULLIF(?,''),title), meta_description=COALESCE(?,meta_description), built_at=COALESCE(built_at,datetime('now')), marked_complete_at=COALESCE(marked_complete_at,datetime('now')) WHERE id=?`)
        .bind(path, url, url, String(auditPage.title ?? ''), auditPage.meta_description ?? null, pageId).run();
    } else {
      const inserted = await c.env.DB.prepare(`INSERT INTO pages (project_id,type,service,city,slug,url,title,meta_description,status,billing_status,published_url,built_at,marked_complete_at,operator_notes)
        VALUES (?,?,?,?,?,?,?,?, 'complete','included',?,datetime('now'),datetime('now'),'Imported from live-site SEO crawl')`)
        .bind(projectId, classification.type, classification.service, classification.city, path, url, auditPage.title ?? null, auditPage.meta_description ?? null, url).run();
      pageId = Number(inserted.meta.last_row_id);
      imported += 1;
    }
    await c.env.DB.batch([
      c.env.DB.prepare('UPDATE seo_audit_pages SET page_id=? WHERE id=?').bind(pageId, auditPage.id),
      c.env.DB.prepare('UPDATE seo_audit_findings SET page_id=? WHERE run_id=? AND page_url=?').bind(pageId, run.id, url),
    ]);
  }
  await c.env.DB.prepare(`UPDATE projects SET pages_built=(SELECT COUNT(*) FROM pages WHERE project_id=? AND status='complete'), pages_planned=MAX(pages_planned,(SELECT COUNT(*) FROM pages WHERE project_id=?)), updated_at=datetime('now') WHERE id=?`).bind(projectId, projectId, projectId).run();
  await createAuditWorkForRun(c.env.DB, projectId, run.id);
  const remaining = await c.env.DB.prepare('SELECT COUNT(*) AS count FROM seo_audit_pages WHERE run_id=? AND page_id IS NULL AND status_code BETWEEN 200 AND 399').bind(run.id).first<{ count: number }>();
  return c.json({ imported, linked: (auditPages.results?.length ?? 0) - imported, remaining: remaining?.count ?? 0 });
});

seoAuditsRouter.get('/seo-audits/:id/pages', async (c) => {
  const runId = Number(c.req.param('id'));
  if (!Number.isFinite(runId)) return c.json(badRequest('Invalid audit id'), 400);
  const pages = await c.env.DB.prepare('SELECT * FROM seo_audit_pages WHERE run_id=? ORDER BY url').bind(runId).all();
  return c.json({ pages: pages.results });
});

type ImportedClassification = { type: string; service: string | null; city: string | null };
function parseList(value: string | null): string[] { if (!value) return []; try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed.map(String) : []; } catch { return value.split(',').map((item) => item.trim()).filter(Boolean); } }
function slug(value: string): string { return value.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }
function classifyImportedPage(path: string, title: string, services: string[]): ImportedClassification {
  const normalized = path.toLowerCase();
  const foundation: Record<string, string> = { '/': 'homepage', '/about': 'about', '/about-us': 'about', '/contact': 'contact', '/contact-us': 'contact', '/faq': 'faq', '/faqs': 'faq', '/services': 'services_overview', '/service-areas': 'service_areas_overview' };
  if (foundation[normalized]) return { type: foundation[normalized], service: null, city: null };
  const matchedService = services.find((service) => normalized === `/services/${slug(service)}` || normalized.endsWith(`/${slug(service)}`));
  if (matchedService) return { type: 'service', service: matchedService, city: null };
  return { type: 'custom', service: title.trim() || humanize(normalized.split('/').filter(Boolean).pop() ?? '') || 'Imported page', city: null };
}
function humanize(value: string): string { return value.replace(/-/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()); }
async function findExistingPage(db: D1Database, projectId: number, classification: ImportedClassification, path: string): Promise<{ id: number } | null> {
  const byUrl = await db.prepare("SELECT id FROM pages WHERE project_id=? AND (lower(COALESCE(slug,''))=lower(?) OR lower(COALESCE(published_url,'')) LIKE ?) LIMIT 1").bind(projectId, path, `%${path}`).first<{ id: number }>();
  if (byUrl) return byUrl;
  if (classification.type === 'custom') return null;
  return db.prepare(`SELECT id FROM pages WHERE project_id=? AND type=? AND COALESCE(service,'')=COALESCE(?,'') AND COALESCE(city,'')=COALESCE(?,'') LIMIT 1`)
    .bind(projectId, classification.type, classification.service, classification.city).first<{ id: number }>();
}
