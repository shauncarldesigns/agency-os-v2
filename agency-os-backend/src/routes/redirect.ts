// Public click-tracker redirect for the Automated Pipeline.
//
// Layer 1 of the two-layer engagement tracking (Layer 2 is Clarity's
// on-site data). Every intro/follow-up text points at this URL instead
// of the raw landingsite URL — a click here is the trustworthy signal
// that the recipient actually opened the link, independent of whether
// Clarity is set up on the destination site.
//
// Mounts at the app root (NOT under /api/*) so the auth middleware
// doesn't reject the recipient's browser request.

import { Hono } from 'hono';
import type { Env, Lead } from '../types';
import { log } from '../utils/errors';

export const redirectRouter = new Hono<{ Bindings: Env }>();

// GET /r/:lead_id
redirectRouter.get('/r/:lead_id', async (c) => {
  const raw = c.req.param('lead_id');
  const id = parseInt(raw, 10);
  if (isNaN(id) || id <= 0) return c.text('Invalid link', 400);

  try {
    const lead = await c.env.DB.prepare(
      `SELECT id, site_url, pipeline_status, pipeline_sessions
         FROM leads
        WHERE id = ? AND deleted_at IS NULL`,
    )
      .bind(id)
      .first<Pick<Lead, 'id'> & {
        site_url: string | null;
        pipeline_status: string;
        pipeline_sessions: number;
      }>();

    if (!lead || !lead.site_url) return c.text('Link expired or not found', 404);

    // Bump the click counter. If this was the lead's first click and they
    // were still 'sent_no_reply', promote them to 'engaged' so the operator
    // sees the amber card + warm follow-up variant without waiting on
    // Clarity's async sync.
    const shouldPromote =
      lead.pipeline_status === 'sent_no_reply' && lead.pipeline_sessions === 0;
    const nextStatus = shouldPromote ? 'engaged' : lead.pipeline_status;

    // Coarse UA only — privacy note in the brief: no personal data in logs.
    const ua = c.req.header('user-agent') ?? '';
    const uaClass = /iPhone|iPad|iPod/i.test(ua)
      ? 'ios'
      : /Android/i.test(ua)
        ? 'android'
        : /Mobile/i.test(ua)
          ? 'mobile'
          : 'desktop';

    await c.env.DB.prepare(
      `UPDATE leads
         SET pipeline_sessions = pipeline_sessions + 1,
             pipeline_status = ?,
             pipeline_last_action_at = datetime('now'),
             updated_at = datetime('now')
         WHERE id = ?`,
    )
      .bind(nextStatus, id)
      .run();

    await c.env.DB.prepare(
      `INSERT INTO lead_activity (lead_id, action, from_status, to_status, meta)
       VALUES (?, 'click_tracked', ?, ?, ?)`,
    )
      .bind(
        id,
        lead.pipeline_status,
        shouldPromote ? nextStatus : null,
        JSON.stringify({ ua_class: uaClass }),
      )
      .run();

    log('info', 'redirect', `Click tracked for lead ${id}`, { promoted: shouldPromote, ua_class: uaClass });
    return c.redirect(lead.site_url, 302);
  } catch (err) {
    log('error', 'redirect', 'Click tracker failed', err);
    // Failing to log a click should NOT break the recipient's experience.
    // If we at least know the target URL, best-effort redirect anyway.
    try {
      const fallback = await c.env.DB.prepare('SELECT site_url FROM leads WHERE id = ?')
        .bind(id)
        .first<{ site_url: string | null }>();
      if (fallback?.site_url) return c.redirect(fallback.site_url, 302);
    } catch {
      // fall through
    }
    return c.text('Link temporarily unavailable', 500);
  }
});
