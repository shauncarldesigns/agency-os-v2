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
const CALENDAR_URL =
  'https://shauncarldesigns397463.hbportal.co/public/69d52364c8dc9c00078c64b6';

// GET /r/:lead_id
redirectRouter.get('/r/:lead_id', async (c) => {
  const raw = c.req.param('lead_id');
  const id = parseInt(raw, 10);
  if (isNaN(id) || id <= 0) return c.text('Invalid link', 400);
  const channel = c.req.query('channel') === 'email' ? 'email' : 'text';

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
    const reply = await c.env.DB.prepare(
      `SELECT 1 AS found
         FROM lead_activity activity
        WHERE activity.lead_id = ?
          AND activity.action = 'reply_received'
          AND NOT EXISTS (
            SELECT 1
              FROM lead_activity undo
             WHERE undo.action = 'undo'
               AND json_extract(undo.meta, '$.undid_activity_id') = activity.id
          )
        LIMIT 1`,
    ).bind(id).first<{ found: number }>();
    const clickFloor = reply ? 55 : 40;
    const clickReason = reply
      ? '+15 clicked tracked link after replying'
      : channel === 'email'
        ? '+40 clicked tracked email link'
        : '+40 clicked tracked text link';

    // Bump the click counter. Any tracked click from Sent — No Reply makes
    // the lead Engaged; old/imported rows may already have a session count
    // without the status having been promoted.
    const shouldPromote = lead.pipeline_status === 'sent_no_reply';
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
             engagement_score = MAX(engagement_score, ?),
             engagement_grade = CASE
               WHEN MAX(engagement_score, ?) >= 90 THEN 'hot'
               WHEN MAX(engagement_score, ?) >= 70 THEN 'walkthrough'
               WHEN MAX(engagement_score, ?) >= 40 THEN 'follow_up'
               ELSE 'nurture'
             END,
             engagement_reasons = CASE
               WHEN COALESCE(engagement_reasons, '') LIKE ?
                 THEN engagement_reasons
               WHEN json_valid(engagement_reasons)
                 THEN json_insert(engagement_reasons, '$[#]', ?)
               ELSE json_array(?)
             END,
             pipeline_last_action_at = datetime('now'),
             updated_at = datetime('now')
         WHERE id = ?`,
    )
      .bind(
        nextStatus,
        clickFloor,
        clickFloor,
        clickFloor,
        clickFloor,
        `%clicked tracked ${channel} link%`,
        clickReason,
        clickReason,
        id,
      )
      .run();

    await c.env.DB.prepare(`
      UPDATE email_automations
         SET status = 'completed', current_step = 'complete', branch = 'demo_clicked',
             completed_at = datetime('now'), next_run_at = NULL,
             processing_at = NULL, updated_at = datetime('now')
       WHERE lead_id = ? AND status IN ('active', 'paused')
    `).bind(id).run();

    if (channel === 'email') {
      const latestSend = await c.env.DB.prepare(`
        SELECT id FROM email_sends
         WHERE lead_id = ?
         ORDER BY id DESC LIMIT 1
      `).bind(id).first<{ id: number }>();
      if (latestSend) {
        const clickedAt = new Date().toISOString();
        await c.env.DB.batch([
          c.env.DB.prepare(`
            UPDATE email_sends
               SET clicked_at = COALESCE(clicked_at, ?),
                   status = CASE
                     WHEN status IN ('bounced', 'complained', 'suppressed', 'failed') THEN status
                     ELSE 'clicked'
                   END,
                   updated_at = datetime('now')
             WHERE id = ?
          `).bind(clickedAt, latestSend.id),
          c.env.DB.prepare(`
            INSERT OR IGNORE INTO email_events (
              email_send_id, event_key, event_type, event_at, payload
            ) VALUES (?, ?, 'first_party.clicked', ?, ?)
          `).bind(
            latestSend.id,
            `redirect:${latestSend.id}:clicked`,
            clickedAt,
            JSON.stringify({ channel, ua_class: uaClass }),
          ),
        ]);
      }
    }

    await c.env.DB.prepare(
      `INSERT INTO lead_activity (lead_id, action, from_status, to_status, meta)
       VALUES (?, 'click_tracked', ?, ?, ?)`,
    )
      .bind(
        id,
        lead.pipeline_status,
        shouldPromote ? nextStatus : null,
        JSON.stringify({ ua_class: uaClass, channel }),
      )
      .run();

    log('info', 'redirect', `Click tracked for lead ${id}`, { promoted: shouldPromote, ua_class: uaClass });
    return c.redirect(trackedDestination(lead.site_url, channel), 302);
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

function trackedDestination(siteUrl: string, channel: 'email' | 'text'): string {
  if (channel !== 'email') return siteUrl;
  try {
    const url = new URL(siteUrl);
    url.searchParams.set('utm_source', 'email');
    url.searchParams.set('utm_medium', 'email');
    return url.toString();
  } catch {
    return siteUrl;
  }
}

// GET /book/:lead_id — records scheduling intent, then forwards to the
// agency's public HoneyBook calendar. This is deliberately separate from
// website sessions/Clarity: opening a calendar is an 80-point intent floor,
// not a site visit or confirmed booking.
redirectRouter.get('/book/:lead_id', async (c) => {
  const id = parseInt(c.req.param('lead_id'), 10);
  if (isNaN(id) || id <= 0) return c.redirect(CALENDAR_URL, 302);

  try {
    const lead = await c.env.DB.prepare(
      `SELECT id, pipeline_status
         FROM leads
        WHERE id = ? AND deleted_at IS NULL`,
    ).bind(id).first<{ id: number; pipeline_status: string }>();
    if (!lead) return c.redirect(CALENDAR_URL, 302);

    const nextStatus =
      lead.pipeline_status === 'sent_no_reply' ? 'engaged' : lead.pipeline_status;
    const reason = '+80 opened scheduling calendar';
    await c.env.DB.prepare(
      `UPDATE leads
          SET pipeline_status = ?,
              engagement_score = MAX(engagement_score, 80),
              engagement_grade = CASE
                WHEN MAX(engagement_score, 80) >= 90 THEN 'hot'
                ELSE 'walkthrough'
              END,
              engagement_reasons = CASE
                WHEN COALESCE(engagement_reasons, '') LIKE '%opened scheduling calendar%'
                  THEN engagement_reasons
                WHEN json_valid(engagement_reasons)
                  THEN json_insert(engagement_reasons, '$[#]', ?)
                ELSE json_array(?)
              END,
              pipeline_last_action_at = datetime('now'),
              updated_at = datetime('now')
        WHERE id = ?`,
    ).bind(nextStatus, reason, reason, id).run();

    await c.env.DB.prepare(
      `INSERT INTO lead_activity (lead_id, action, from_status, to_status, meta)
       VALUES (?, 'calendar_clicked', ?, ?, ?)`,
    ).bind(
      id,
      lead.pipeline_status,
      nextStatus !== lead.pipeline_status ? nextStatus : null,
      JSON.stringify({ destination: 'honeybook' }),
    ).run();

    log('info', 'redirect', `Calendar click tracked for lead ${id}`, {
      promoted: nextStatus !== lead.pipeline_status,
    });
  } catch (err) {
    log('error', 'redirect', 'Calendar click tracker failed', err);
  }
  return c.redirect(CALENDAR_URL, 302);
});
