import { Hono } from 'hono';
import type { Env, Project, Lead, BrandAttributeCategory } from '../types';
import { badRequest, notFound, serverError, log } from '../utils/errors';
import { scrapeWebsite } from '../services/scraper';

export const scrapeRouter = new Hono<{ Bindings: Env }>();

// POST /api/projects/:projectId/scrape
// Body (all optional): { url?: string, force?: boolean }
//   - url: override the lead's website (rare — for manual runs against a staging URL)
//   - force: re-run even if scrape_completed_at is set
scrapeRouter.post('/projects/:projectId/scrape', async (c) => {
  try {
    const projectId = Number(c.req.param('projectId'));
    if (!Number.isFinite(projectId)) return c.json(badRequest('Invalid projectId'), 400);

    const body = (await c.req.json().catch(() => ({}))) as { url?: string; force?: boolean };

    const project = await c.env.DB.prepare('SELECT * FROM projects WHERE id = ?').bind(projectId).first<Project>();
    if (!project) return c.json(notFound('Project'), 404);

    if (project.scrape_completed_at && !body.force) {
      return c.json({
        ok: false,
        reason: 'already-scraped',
        scrape_completed_at: project.scrape_completed_at,
        message: 'Pass { "force": true } to re-run',
      });
    }

    // Resolve target URL.
    let targetUrl = body.url ?? null;
    if (!targetUrl && project.lead_id) {
      const lead = await c.env.DB.prepare('SELECT website FROM leads WHERE id = ?')
        .bind(project.lead_id)
        .first<Pick<Lead, 'website'>>();
      targetUrl = lead?.website ?? null;
    }
    if (!targetUrl) {
      return c.json({ ok: false, reason: 'no-website', message: 'Project has no website URL on file' });
    }

    log('info', 'scrape', `Scraping ${targetUrl} for project ${projectId}`);
    const result = await scrapeWebsite(c.env.CLAUDE_API_KEY, project.business_name, targetUrl);

    // Persist raw text + completion timestamp regardless of extraction success,
    // so the operator-form flow doesn't re-run scrape on every open.
    await c.env.DB.prepare(
      `UPDATE projects
       SET scrape_data = ?,
           scrape_completed_at = datetime('now'),
           updated_at = datetime('now')
       WHERE id = ?`
    )
      .bind(
        JSON.stringify({
          url: targetUrl,
          pages: result.pagesFetched,
          bytes: result.rawTextBytes,
          text: result.rawText.slice(0, 30000), // cap stored text — Claude prompt re-trims anyway
          extracted: result.extracted,
          ok: result.ok,
          reason: result.reason ?? null,
        }),
        projectId
      )
      .run();

    let insertedAttrs = 0;
    if (result.ok && result.extracted) {
      const e = result.extracted;
      const rows: Array<{ category: BrandAttributeCategory; value: string }> = [];
      if (e.tagline) rows.push({ category: 'tagline', value: e.tagline });
      if (e.positioning) rows.push({ category: 'positioning', value: e.positioning });
      if (e.owner_story) rows.push({ category: 'other', value: e.owner_story });
      for (const cert of e.certifications ?? []) rows.push({ category: 'certification', value: cert });
      for (const phrase of e.distinctive_phrases ?? []) rows.push({ category: 'review_theme', value: phrase });

      for (const r of rows) {
        if (!r.value || !r.value.trim()) continue;
        await c.env.DB.prepare(
          `INSERT INTO brand_attributes (project_id, category, value, source) VALUES (?, ?, ?, 'scrape')`
        )
          .bind(projectId, r.category, r.value.trim())
          .run();
        insertedAttrs++;
      }
    }

    return c.json({
      ok: result.ok,
      reason: result.reason ?? null,
      pages_fetched: result.pagesFetched,
      bytes: result.rawTextBytes,
      brand_attributes_inserted: insertedAttrs,
      extracted: result.extracted,
    });
  } catch (err) {
    log('error', 'scrape', 'POST /scrape failed', err);
    return c.json(serverError(`Scrape failed: ${(err as Error).message}`), 500);
  }
});
