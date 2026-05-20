import { Hono } from 'hono';
import type { Env } from '../types';
import { badRequest, serverError, log } from '../utils/errors';

export const webhookRouter = new Hono<{ Bindings: Env }>();

webhookRouter.post('/cowork/started', async (c) => {
  try {
    const body = await c.req.json() as { jobId: number; projectId?: number };
    if (!body.jobId) return c.json(badRequest('jobId required'), 400);

    await c.env.DB.prepare(
      "UPDATE brief_jobs SET status = 'processing', cowork_started_at = datetime('now') WHERE id = ?"
    ).bind(body.jobId).run();

    log('info', 'webhook', `Job ${body.jobId} started by Cowork`);
    return c.json({ ok: true });
  } catch (err) {
    log('error', 'webhook', 'POST /webhook/cowork/started failed', err);
    return c.json(serverError(), 500);
  }
});

webhookRouter.post('/cowork/completed', async (c) => {
  try {
    const body = await c.req.json() as {
      jobId: number;
      success: boolean;
      pageUrl?: string;
      error?: string;
    };
    if (!body.jobId) return c.json(badRequest('jobId required'), 400);

    const job = await c.env.DB.prepare('SELECT * FROM brief_jobs WHERE id = ?').bind(body.jobId).first<{
      id: number; project_id: number; page_id: number | null; job_type: string;
    }>();
    if (!job) return c.json(badRequest('Unknown jobId'), 400);

    if (body.success) {
      await c.env.DB.prepare(
        "UPDATE brief_jobs SET status = 'done', cowork_completed_at = datetime('now'), error_message = NULL WHERE id = ?"
      ).bind(body.jobId).run();

      // If this job has a page_id, mark the page as built
      if (job.page_id) {
        await c.env.DB.prepare(
          "UPDATE pages SET status = 'built', built_at = datetime('now'), url = COALESCE(?, url) WHERE id = ?"
        ).bind(body.pageUrl ?? null, job.page_id).run();

        // Bump project pages_built
        await c.env.DB.prepare(
          "UPDATE projects SET pages_built = pages_built + 1, updated_at = datetime('now') WHERE id = ?"
        ).bind(job.project_id).run();
      } else if (job.job_type === 'initial-build') {
        // Initial build complete → flip project to 'live' if not already
        await c.env.DB.prepare(
          "UPDATE projects SET status = 'live', landingsite_url = COALESCE(?, landingsite_url), updated_at = datetime('now') WHERE id = ? AND status = 'building'"
        ).bind(body.pageUrl ?? null, job.project_id).run();
      }
    } else {
      await c.env.DB.prepare(
        "UPDATE brief_jobs SET status = 'failed', cowork_completed_at = datetime('now'), error_message = ?, retries = retries + 1 WHERE id = ?"
      ).bind(body.error ?? 'Unknown error', body.jobId).run();
    }

    log('info', 'webhook', `Job ${body.jobId} completed`, { success: body.success, error: body.error });
    return c.json({ ok: true });
  } catch (err) {
    log('error', 'webhook', 'POST /webhook/cowork/completed failed', err);
    return c.json(serverError(), 500);
  }
});

// Manual mark-complete — operator says "I just pasted into Cowork and it's done"
webhookRouter.post('/cowork/manual-complete', async (c) => {
  try {
    const body = await c.req.json() as { jobId: number; pageUrl?: string };
    if (!body.jobId) return c.json(badRequest('jobId required'), 400);

    const job = await c.env.DB.prepare('SELECT * FROM brief_jobs WHERE id = ?').bind(body.jobId).first<{
      id: number; project_id: number; page_id: number | null; job_type: string;
    }>();
    if (!job) return c.json(badRequest('Unknown jobId'), 400);

    await c.env.DB.prepare(
      "UPDATE brief_jobs SET status = 'done', cowork_completed_at = datetime('now'), error_message = NULL WHERE id = ?"
    ).bind(body.jobId).run();

    if (job.page_id) {
      await c.env.DB.prepare(
        "UPDATE pages SET status = 'built', built_at = datetime('now'), url = COALESCE(?, url) WHERE id = ?"
      ).bind(body.pageUrl ?? null, job.page_id).run();
      await c.env.DB.prepare(
        "UPDATE projects SET pages_built = pages_built + 1, updated_at = datetime('now') WHERE id = ?"
      ).bind(job.project_id).run();
    } else if (job.job_type === 'initial-build') {
      await c.env.DB.prepare(
        "UPDATE projects SET status = 'live', landingsite_url = COALESCE(?, landingsite_url), updated_at = datetime('now') WHERE id = ? AND status = 'building'"
      ).bind(body.pageUrl ?? null, job.project_id).run();
    }

    log('info', 'webhook', `Job ${body.jobId} manually marked complete`);
    return c.json({ ok: true });
  } catch (err) {
    log('error', 'webhook', 'POST /webhook/cowork/manual-complete failed', err);
    return c.json(serverError(), 500);
  }
});
