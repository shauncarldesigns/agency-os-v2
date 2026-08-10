// Automated Pipeline — text + site outreach queue.
//
// Read + mutation endpoints for the LeadPipelinePage. Sits alongside the
// cold-call motion; both read the same `leads` table but track their own
// status columns (leads.status for cold-call lifecycle,
// leads.pipeline_status for the text+site flow — see the 2026-07-19
// migration).
//
// The public `/r/:lead_id` click tracker lives in a separate router
// (routes/redirect.ts) so it can mount OUTSIDE the /api auth boundary.

import { Hono } from 'hono';
import type { Env, Lead } from '../types';
import { badRequest, notFound, log, serverError } from '../utils/errors';
import { buildPipelineBriefPrompt } from '../prompts/pipelineBrief';
import { callClaude } from '../services/claude';
import { fetchOutscraperReviews, mergeReviews } from '../services/outscraper';
import type { GoogleReview } from '../services/places';
import { buildClaritySnippet, syncClarityEngagement } from '../services/clarity';
import { scheduleEmailAutomation } from '../services/emailAutomation';

const BRIEF_MODEL = 'claude-haiku-4-5-20251001';

// ---------------------------------------------------------------------------
// Status enum + transition rules (enforced server-side).
// The client mirrors this list; keep the two in sync.
// ---------------------------------------------------------------------------

export type PipelineStatus =
  | 'awaiting_build'
  | 'ready_to_send'
  | 'sent_no_reply'
  | 'engaged'
  | 'booked'
  | 'archived';

const REVERSIBLE_ACTIONS = new Set([
  'url_saved',
  'email_sent',
  'email_followed_up',
  'email_final_touch',
  'intro_sent',
  'followed_up',
  'reply_received',
  'call_outcome',
  'calendar_sent',
  'scheduling_followup',
  'called',
  'archived',
]);

interface LeadActivityRow {
  id: number;
  lead_id: number;
  action: string;
  from_status: string | null;
  to_status: string | null;
  meta: string | null;
  created_at: string;
}

export const pipelineRouter = new Hono<{ Bindings: Env }>();

const PIPELINE_LEAD_SELECT = `
  SELECT leads.*,
         CASE
           WHEN leads.pipeline_status = 'engaged' THEN (
             SELECT COUNT(*)
               FROM lead_activity
              WHERE lead_activity.lead_id = leads.id
                AND lead_activity.action = 'followed_up'
                AND lead_activity.from_status = 'engaged'
                AND NOT EXISTS (
                  SELECT 1
                    FROM lead_activity AS undo_activity
                   WHERE undo_activity.action = 'undo'
                     AND json_extract(undo_activity.meta, '$.undid_activity_id') = lead_activity.id
                )
           )
           ELSE 0
         END AS pipeline_followup_step,
         CASE
           WHEN leads.pipeline_status = 'sent_no_reply' THEN (
             SELECT COUNT(*)
               FROM lead_activity
              WHERE lead_activity.lead_id = leads.id
                AND lead_activity.action = 'followed_up'
                AND lead_activity.from_status = 'sent_no_reply'
                AND NOT EXISTS (
                  SELECT 1
                    FROM lead_activity AS undo_activity
                   WHERE undo_activity.action = 'undo'
                     AND json_extract(undo_activity.meta, '$.undid_activity_id') = lead_activity.id
                )
           )
           ELSE 0
         END AS pipeline_no_reply_step,
         EXISTS (
           SELECT 1
             FROM lead_activity AS reply_activity
            WHERE reply_activity.lead_id = leads.id
              AND reply_activity.action = 'reply_received'
              AND NOT EXISTS (
                SELECT 1
                  FROM lead_activity AS undo_activity
                 WHERE undo_activity.action = 'undo'
                   AND json_extract(undo_activity.meta, '$.undid_activity_id') = reply_activity.id
              )
         ) AS pipeline_replied,
         EXISTS (
           SELECT 1 FROM lead_activity AS calendar_sent_activity
           WHERE calendar_sent_activity.lead_id = leads.id
             AND calendar_sent_activity.action = 'calendar_sent'
             AND NOT EXISTS (
               SELECT 1
                 FROM lead_activity AS undo_activity
                WHERE undo_activity.action = 'undo'
                  AND json_extract(undo_activity.meta, '$.undid_activity_id') = calendar_sent_activity.id
             )
         ) AS pipeline_calendar_sent,
         EXISTS (
           SELECT 1 FROM lead_activity AS calendar_click_activity
           WHERE calendar_click_activity.lead_id = leads.id
             AND calendar_click_activity.action = 'calendar_clicked'
         ) AS pipeline_calendar_clicked,
         EXISTS (
           SELECT 1 FROM lead_activity AS scheduling_followup_activity
           WHERE scheduling_followup_activity.lead_id = leads.id
             AND scheduling_followup_activity.action = 'scheduling_followup'
             AND NOT EXISTS (
               SELECT 1
                 FROM lead_activity AS undo_activity
                WHERE undo_activity.action = 'undo'
                  AND json_extract(undo_activity.meta, '$.undid_activity_id') = scheduling_followup_activity.id
             )
         ) AS pipeline_scheduling_followup_sent,
         (
           SELECT latest_activity.action
             FROM lead_activity AS latest_activity
            WHERE latest_activity.lead_id = leads.id
              AND latest_activity.action != 'undo'
              AND NOT EXISTS (
                SELECT 1
                  FROM lead_activity AS undo_activity
                 WHERE undo_activity.action = 'undo'
                   AND json_extract(undo_activity.meta, '$.undid_activity_id') = latest_activity.id
              )
            ORDER BY latest_activity.created_at DESC, latest_activity.id DESC
            LIMIT 1
         ) AS pipeline_last_action
    FROM leads`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Slugify a business name for the UTM campaign param. Lowercase, spaces →
// hyphens, non-alphanumerics stripped, collapsed dashes. Idempotent.
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

// Build the tagged live URL. Preserves any existing query string with `&`.
function tagUrl(rawUrl: string, slug: string, channel: 'email' | 'sms'): string {
  const sep = rawUrl.includes('?') ? '&' : '?';
  const medium = channel === 'email' ? 'email' : 'text';
  return `${rawUrl}${sep}utm_source=${channel}&utm_medium=${medium}&utm_campaign=${encodeURIComponent(slug)}`;
}

export async function completePipelineBuild(
  env: Env,
  lead: Lead,
  rawUrl: string,
): Promise<Lead | null> {
  const slug = slugify(lead.company || `lead-${lead.id}`);
  const channel = lead.email && lead.phone_route !== 'text' ? 'email' : 'sms';
  const tagged = tagUrl(rawUrl, slug, channel);
  await env.DB.prepare(
    `UPDATE leads
       SET site_url = ?, site_url_raw = ?, campaign_slug = ?, clarity_tag = ?,
           pipeline_status = 'ready_to_send', pipeline_last_action_at = datetime('now'),
           updated_at = datetime('now')
     WHERE id = ? AND pipeline_status = 'awaiting_build' AND deleted_at IS NULL`,
  ).bind(tagged, rawUrl, slug, `lead-${lead.id}`, lead.id).run();
  await writeActivity(env.DB, {
    leadId: lead.id, action: 'url_saved', fromStatus: 'awaiting_build',
    toStatus: 'ready_to_send', meta: { url: tagged, raw_url: rawUrl, channel },
  });
  await scheduleEmailAutomation(env, lead.id);
  return env.DB.prepare(`${PIPELINE_LEAD_SELECT} WHERE leads.id = ?`).bind(lead.id).first<Lead>();
}

// Format the lead's full mined review set (Google Places' 5 + Outscraper's
// backfill up to 50) as a verbatim block appended AFTER the Claude-generated
// brief. Deliberately NOT routed through Claude: the operator needs exact
// review content inside landingsite, and a model would paraphrase, trim, or
// hit output limits. Reviews without text (rating-only) are skipped.
function formatVerbatimReviews(googleReviewsJson: string | null): string | null {
  if (!googleReviewsJson) return null;
  let reviews: Array<{ author?: string; rating?: number; text?: string; relativeTime?: string }>;
  try {
    const parsed = JSON.parse(googleReviewsJson);
    if (!Array.isArray(parsed)) return null;
    reviews = parsed;
  } catch {
    return null;
  }
  const withText = reviews.filter(
    (r) => typeof r.text === 'string' && r.text.trim().length > 0,
  );
  if (withText.length === 0) return null;

  // Block-per-review format, matching the Sites tab's Quick Brief (the
  // format already proven with landingsite's same-day demos): author line,
  // "5★ · 3 months ago" meta line, then the full text — instead of a dense
  // numbered one-line-per-review dump.
  const lines: string[] = [
    'CUSTOMER REVIEWS (VERBATIM)',
    `All ${withText.length} mined reviews with text, unedited. Use these exact quotes on the site — pick the strongest, attribute by first name, do not rewrite or invent.`,
    '',
  ];
  for (const r of withText) {
    lines.push('');
    lines.push(r.author?.trim() || 'Anonymous');
    const meta: string[] = [];
    if (typeof r.rating === 'number') meta.push(`${r.rating}★`);
    if (r.relativeTime) meta.push(r.relativeTime);
    if (meta.length) lines.push(meta.join(' · '));
    lines.push(r.text!.trim());
    lines.push('');
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

// Deterministic contact block appended after the Claude-generated brief,
// same pattern as the verbatim reviews block. The prompt instructs the
// model to inline contact details verbatim, but a generation that
// compresses "(920) 829-5232" into "phone number" leaves landingsite with
// an instruction it can't satisfy — the brief is its only data source.
// Appending the exact values server-side removes that coin flip.
function formatVerbatimContact(lead: Lead): string {
  const lines: string[] = [
    'CONTACT DETAILS (VERBATIM)',
    'Use these exact values anywhere the page shows contact info. Do not reformat or invent alternatives; omit anything not listed here.',
    '',
    `Business name: ${lead.company}`,
  ];
  if (lead.phone) lines.push(`Phone: ${lead.phone}`);
  if (lead.address) lines.push(`Address: ${lead.address}`);
  // gbp_hours is a JSON array of "Monday: 8:00 AM – 4:00 PM" strings.
  if (lead.gbp_hours) {
    try {
      const hours = JSON.parse(lead.gbp_hours);
      if (Array.isArray(hours) && hours.length) {
        lines.push('Hours:');
        for (const h of hours) {
          if (typeof h === 'string') lines.push(`  ${h}`);
        }
      }
    } catch {
      // Unparseable hours are dropped rather than pasted as raw JSON.
    }
  }
  // The Google Maps listing is the one legitimate citation link a
  // no-website business has. place_ids are long random strings — exactly
  // the kind of value model transcription mangles, so it lives here.
  if (lead.place_id) {
    lines.push(
      `Google Business Profile listing (use as the sameAs link in the LocalBusiness schema): https://www.google.com/maps/place/?q=place_id:${lead.place_id}`,
    );
  }
  return lines.join('\n');
}

function formatClarityInstallBlock(env: Env, lead: Lead): string {
  const campaign = lead.campaign_slug || slugify(lead.company || `lead-${lead.id}`);
  const clarityTag = lead.clarity_tag || `lead-${lead.id}`;
  const snippet = buildClaritySnippet(env, {
    id: lead.id,
    company: lead.company,
    campaign_slug: campaign,
    clarity_tag: clarityTag,
  });
  return [
    'CLARITY TRACKING INSTALL BLOCK',
    'Paste this entire block into the global header/custom-code area so every page inherits both Clarity analytics and Agency OS human-visit confirmation. Do not remove the confirmation code or create a new Clarity project for this lead.',
    '',
    snippet,
  ].join('\n');
}

async function writeActivity(
  db: D1Database,
  input: {
    leadId: number;
    action: string;
    fromStatus?: string | null;
    toStatus?: string | null;
    meta?: unknown;
  },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO lead_activity (lead_id, action, from_status, to_status, meta)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .bind(
      input.leadId,
      input.action,
      input.fromStatus ?? null,
      input.toStatus ?? null,
      input.meta !== undefined ? JSON.stringify(input.meta) : null,
    )
    .run();
}

// ---------------------------------------------------------------------------
// GET /api/pipeline/leads
// ---------------------------------------------------------------------------
// Returns the automated-pipeline queue. Filters at the SQL boundary to the
// leads that actually belong in this flow:
//   - not soft-deleted
//   - lifecycle status in ('cold','contacted') — excludes qualified/client/dead
//   - pipeline_status still active — excludes booked/archived once the lead
//     has moved into Sites or out of this motion
//   - phone route is textable or not classified yet — classified landline /
//     manual-review numbers are withheld from Text Outreach
//   - enriched (need reviews/hours/etc. to build a brief)
//   - no existing website (the whole thesis: build them one)
// Ordered by opportunity_score DESC so the highest-signal leads surface first.
// Optional query params: ?status=<pipeline_status>&q=<name search>
pipelineRouter.get('/leads', async (c) => {
  try {
    const { status, q } = c.req.query();
    // v1 invariant: Sent — No Reply means no tracked session yet. Clean up
    // older/local rows that already have sessions but were not promoted.
    await c.env.DB.prepare(`
      UPDATE leads
         SET pipeline_status = 'engaged',
             updated_at = datetime('now')
       WHERE deleted_at IS NULL
         AND pipeline_status = 'sent_no_reply'
         AND pipeline_sessions > 0
    `).run();

    const clauses: string[] = [
      'deleted_at IS NULL',
      "status IN ('cold', 'contacted')",
      "pipeline_status NOT IN ('booked', 'archived')",
      "COALESCE(phone_route, 'unknown') IN ('unknown', 'text')",
      'has_website = 0',
      "enrichment_status = 'enriched'",
    ];
    const params: unknown[] = [];
    if (status) {
      clauses.push('pipeline_status = ?');
      params.push(status);
    }
    if (q) {
      clauses.push('company LIKE ?');
      params.push(`%${q}%`);
    }
    const sql = `${PIPELINE_LEAD_SELECT}
                 WHERE ${clauses.join(' AND ')}
                 ORDER BY opportunity_score DESC NULLS LAST, id ASC
                 LIMIT 500`;
    const result = await c.env.DB.prepare(sql).bind(...params).all<Lead>();
    return c.json({ leads: result.results ?? [] });
  } catch (err) {
    log('error', 'pipeline', 'GET /leads failed', err);
    return c.json(serverError(), 500);
  }
});

// ---------------------------------------------------------------------------
// GET /api/pipeline/leads/:id — single lead + recent activity
// ---------------------------------------------------------------------------
pipelineRouter.get('/leads/:id', async (c) => {
  try {
    const id = parseInt(c.req.param('id'), 10);
    if (isNaN(id)) return c.json(badRequest('Invalid lead ID'), 400);
    const lead = await c.env.DB.prepare('SELECT * FROM leads WHERE id = ? AND deleted_at IS NULL')
      .bind(id)
      .first<Lead>();
    if (!lead) return c.json(notFound('Lead'), 404);
    const activity = await c.env.DB.prepare(
      `SELECT * FROM lead_activity WHERE lead_id = ? ORDER BY created_at DESC, id DESC LIMIT 50`,
    )
      .bind(id)
      .all<LeadActivityRow>();
    return c.json({ lead, activity: activity.results ?? [] });
  } catch (err) {
    log('error', 'pipeline', 'GET /leads/:id failed', err);
    return c.json(serverError(), 500);
  }
});

// GET /api/pipeline/leads/:id/clarity-snippet — exact install block for
// the lead's demo site. Useful if the operator needs it outside the brief.
pipelineRouter.get('/leads/:id/clarity-snippet', async (c) => {
  try {
    const id = parseInt(c.req.param('id'), 10);
    if (isNaN(id)) return c.json(badRequest('Invalid lead ID'), 400);
    const lead = await c.env.DB.prepare('SELECT * FROM leads WHERE id = ? AND deleted_at IS NULL')
      .bind(id)
      .first<Lead>();
    if (!lead) return c.json(notFound('Lead'), 404);
    return c.json({
      project_id: c.env.CLARITY_PROJECT_ID || 'xt0tg8n14n',
      clarity_tag: lead.clarity_tag || `lead-${lead.id}`,
      campaign_slug: lead.campaign_slug || slugify(lead.company || `lead-${lead.id}`),
      snippet: formatClarityInstallBlock(c.env, lead),
    });
  } catch (err) {
    log('error', 'pipeline', 'GET /leads/:id/clarity-snippet failed', err);
    return c.json(serverError(), 500);
  }
});

// POST /api/pipeline/clarity-sync — manual sync trigger while validating
// Clarity's export data. The hourly cron also calls the same service.
pipelineRouter.post('/clarity-sync', async (c) => {
  try {
    const result = await syncClarityEngagement(c.env);
    return c.json(result);
  } catch (err) {
    log('error', 'pipeline', 'POST /clarity-sync failed', err);
    return c.json(serverError((err as Error).message), 500);
  }
});

// ---------------------------------------------------------------------------
// POST /api/pipeline/leads/:id/site-url
// ---------------------------------------------------------------------------
// Operator has built the site in landingsite.ai and pasted the live URL.
// Server tags it with UTM, stores both raw and tagged, and transitions
// awaiting_build → ready_to_send. Rejected if the lead is not in
// awaiting_build (idempotent from the operator's perspective: they can
// undo and retry, but can't double-save without an explicit reset).
pipelineRouter.post('/leads/:id/site-url', async (c) => {
  try {
    const id = parseInt(c.req.param('id'), 10);
    if (isNaN(id)) return c.json(badRequest('Invalid lead ID'), 400);
    const body = (await c.req.json().catch(() => ({}))) as { url?: string };
    const rawUrl = (body.url ?? '').trim();
    if (!rawUrl) return c.json(badRequest('Missing url'), 400);
    // Landingsite URLs vary, but stored redirects must remain web URLs.
    try {
      const parsed = new URL(rawUrl);
      if (!/^https?:$/.test(parsed.protocol)) throw new Error('unsupported protocol');
    } catch {
      return c.json(badRequest('Invalid url'), 400);
    }

    const lead = await c.env.DB.prepare(
      'SELECT * FROM leads WHERE id = ? AND deleted_at IS NULL',
    )
      .bind(id)
      .first<Lead & { pipeline_status: PipelineStatus; site_url: string | null }>();
    if (!lead) return c.json(notFound('Lead'), 404);
    if (lead.pipeline_status !== 'awaiting_build') {
      return c.json(
        badRequest(
          `Cannot save site URL from status "${lead.pipeline_status}" — must be awaiting_build.`,
          'INVALID_TRANSITION',
        ),
        400,
      );
    }

    const updated = await completePipelineBuild(c.env, lead, rawUrl);
    log('info', 'pipeline', `Lead ${id} URL saved`);
    return c.json({ lead: updated });
  } catch (err) {
    log('error', 'pipeline', 'POST /leads/:id/site-url failed', err);
    return c.json(serverError(), 500);
  }
});

// ---------------------------------------------------------------------------
// POST /api/pipeline/leads/:id/action
// ---------------------------------------------------------------------------
// Body: { action: 'intro_sent' | 'followed_up' | 'reply_received' |
//         'call_outcome' | 'calendar_sent' | 'scheduling_followup' |
//         'called' | 'archived', meta?: unknown }
// Applies the (optional) status transition, updates the last-action pointer,
// writes an activity row. Optimistic: the client fires this on tap of
// "Open in Messages" even though we can't confirm the operator actually
// sent — /undo lets them recover.
type OutreachAction =
  | 'email_sent'
  | 'email_followed_up'
  | 'email_final_touch'
  | 'intro_sent'
  | 'followed_up'
  | 'reply_received'
  | 'call_outcome'
  | 'calendar_sent'
  | 'scheduling_followup'
  | 'called'
  | 'archived';

const ACTION_TRANSITIONS: Record<
  OutreachAction,
  { from?: PipelineStatus[]; to?: PipelineStatus }
> = {
  email_sent: { from: ['ready_to_send'], to: 'sent_no_reply' },
  email_followed_up: { from: ['sent_no_reply', 'engaged'] },
  email_final_touch: { from: ['sent_no_reply', 'engaged'] },
  intro_sent: { from: ['ready_to_send'], to: 'sent_no_reply' },
  followed_up: {}, // no status change — stays in sent_no_reply or engaged
  reply_received: { from: ['sent_no_reply', 'engaged'], to: 'engaged' },
  call_outcome: { from: ['sent_no_reply', 'engaged'] },
  calendar_sent: { from: ['sent_no_reply', 'engaged'] },
  scheduling_followup: { from: ['engaged'] },
  called: {}, // no status change — display-only
  archived: { from: ['sent_no_reply', 'engaged'], to: 'archived' },
};

pipelineRouter.post('/leads/:id/action', async (c) => {
  try {
    const id = parseInt(c.req.param('id'), 10);
    if (isNaN(id)) return c.json(badRequest('Invalid lead ID'), 400);
    const body = (await c.req.json().catch(() => ({}))) as {
      action?: string;
      meta?: unknown;
    };
    const action = body.action as OutreachAction | undefined;
    if (!action || !(action in ACTION_TRANSITIONS)) {
      return c.json(badRequest(`Invalid action "${action}"`), 400);
    }

    const lead = await c.env.DB.prepare(
      'SELECT * FROM leads WHERE id = ? AND deleted_at IS NULL',
    )
      .bind(id)
      .first<Lead & { pipeline_status: PipelineStatus }>();
    if (!lead) return c.json(notFound('Lead'), 404);

    const rules = ACTION_TRANSITIONS[action];
    if (rules.from && !rules.from.includes(lead.pipeline_status)) {
      return c.json(
        badRequest(
          `Cannot ${action} from status "${lead.pipeline_status}".`,
          'INVALID_TRANSITION',
        ),
        400,
      );
    }

    if (action === 'archived' && lead.pipeline_status === 'engaged') {
      const completedSalesCall = await c.env.DB.prepare(`
        SELECT 1 AS found
          FROM lead_activity AS call_activity
         WHERE call_activity.lead_id = ?
           AND call_activity.action = 'call_outcome'
           AND NOT EXISTS (
             SELECT 1
               FROM lead_activity AS undo_activity
              WHERE undo_activity.action = 'undo'
                AND json_extract(undo_activity.meta, '$.undid_activity_id') = call_activity.id
           )
         LIMIT 1
      `).bind(id).first<{ found: number }>();
      if (!completedSalesCall) {
        return c.json(
          badRequest('An engaged lead requires a recorded sales-call outcome before it can be archived.', 'SALES_CALL_REQUIRED'),
          400,
        );
      }
    }

    const fromStatus = lead.pipeline_status;
    const toStatus = rules.to ?? fromStatus;
    const sets = ["pipeline_last_action_at = datetime('now')", "updated_at = datetime('now')"];
    const params: unknown[] = [];
    if (toStatus !== fromStatus) {
      sets.push('pipeline_status = ?');
      params.push(toStatus);
    }
    if (action === 'reply_received') {
      const trackedClick = await c.env.DB.prepare(
        `SELECT 1 AS found
           FROM lead_activity
          WHERE lead_id = ? AND action = 'click_tracked'
          LIMIT 1`,
      ).bind(id).first<{ found: number }>();
      const replyFloor = trackedClick ? 55 : 40;
      const replyReason = trackedClick
        ? '+15 replied after opening site'
        : '+40 replied by text';
      sets.push(
        `engagement_score = MAX(engagement_score, ${replyFloor})`,
        `engagement_grade = CASE
           WHEN MAX(engagement_score, ${replyFloor}) >= 90 THEN 'hot'
           WHEN MAX(engagement_score, ${replyFloor}) >= 70 THEN 'walkthrough'
           ELSE 'follow_up'
         END`,
        `engagement_reasons = CASE
           WHEN COALESCE(engagement_reasons, '') LIKE '%replied%'
             THEN engagement_reasons
           WHEN json_valid(engagement_reasons)
             THEN json_insert(engagement_reasons, '$[#]', '${replyReason}')
           ELSE json_array('${replyReason}')
         END`,
      );
    }
    params.push(id);
    await c.env.DB.prepare(`UPDATE leads SET ${sets.join(', ')} WHERE id = ?`)
      .bind(...params)
      .run();

    if (action === 'call_outcome' && body.meta && typeof body.meta === 'object') {
      const meta = body.meta as Record<string, unknown>;
      const recordingCallId = Number(meta.recording_call_id);
      if (Number.isInteger(recordingCallId) && recordingCallId > 0) {
        const outcome = typeof meta.outcome === 'string'
          ? meta.outcome.replaceAll('_', ' ').replace(/^./, (char) => char.toUpperCase())
          : 'Call completed';
        const notes = typeof meta.notes === 'string' && meta.notes.trim() ? meta.notes.trim() : null;
        await c.env.DB.prepare(
          `UPDATE call_log
              SET outcome = ?, notes = COALESCE(?, notes)
            WHERE id = ? AND lead_id = ?`
        ).bind(outcome, notes, recordingCallId, id).run();
      }
    }

    await writeActivity(c.env.DB, {
      leadId: id,
      action,
      fromStatus,
      toStatus,
      meta:
        action === 'archived'
          ? {
              ...(body.meta && typeof body.meta === 'object' ? body.meta : {}),
              previous_pipeline_last_action_at: lead.pipeline_last_action_at,
            }
          : action === 'reply_received'
            ? {
                ...(body.meta && typeof body.meta === 'object' ? body.meta : {}),
                previous_engagement_score: lead.engagement_score,
                previous_engagement_grade: lead.engagement_grade,
                previous_engagement_reasons: lead.engagement_reasons,
              }
          : body.meta,
    });

    const updated = await c.env.DB.prepare(`${PIPELINE_LEAD_SELECT} WHERE leads.id = ?`)
      .bind(id)
      .first<Lead>();
    log('info', 'pipeline', `Lead ${id} action ${action}`, { fromStatus, toStatus });
    return c.json({ lead: updated });
  } catch (err) {
    log('error', 'pipeline', 'POST /leads/:id/action failed', err);
    return c.json(serverError(), 500);
  }
});

// ---------------------------------------------------------------------------
// POST /api/pipeline/leads/:id/brief
// ---------------------------------------------------------------------------
// Generates a landingsite.ai-ready brief for the lead, caches it on
// `leads.pipeline_brief`, and returns the updated row. Idempotent by
// default — a second call returns the cached brief without re-billing
// Claude. Pass { regenerate: true } to force a fresh generation.
//
// Uses Haiku 4.5 because these briefs are prep material for the operator,
// not final copy — quality is fine at Haiku and cost stays low even if
// the operator regenerates a few times per lead.
pipelineRouter.post('/leads/:id/brief', async (c) => {
  try {
    const id = parseInt(c.req.param('id'), 10);
    if (isNaN(id)) return c.json(badRequest('Invalid lead ID'), 400);
    const body = (await c.req.json().catch(() => ({}))) as { regenerate?: boolean };

    const lead = await c.env.DB.prepare(
      'SELECT * FROM leads WHERE id = ? AND deleted_at IS NULL',
    )
      .bind(id)
      .first<Lead>();
    if (!lead) return c.json(notFound('Lead'), 404);

    if (lead.pipeline_brief && !body.regenerate) {
      return c.json({ lead });
    }

    const prompt = buildPipelineBriefPrompt({
      lead_id: lead.id,
      company: lead.company,
      industry: lead.industry,
      city: lead.city,
      state: lead.state,
      address: lead.address,
      phone: lead.phone,
      hours: lead.gbp_hours,
      google_rating: lead.google_rating,
      google_review_count: lead.google_review_count,
      extracted_services: lead.extracted_services,
      extracted_service_areas: lead.extracted_service_areas,
      extracted_strengths: lead.extracted_strengths,
      extracted_local_landmarks: lead.extracted_local_landmarks,
      pitch_quotes: lead.pitch_quotes,
      owner_names: lead.owner_names,
      opportunity_reasoning: lead.opportunity_reasoning,
    });

    // Google Places caps stored reviews at 5 unless Outscraper backfilled
    // during enrichment. When Google lists more reviews than we hold, pull
    // the full set now — in PARALLEL with the Claude call, since the
    // verbatim block is appended server-side and doesn't feed the prompt.
    // Any failure falls back to whatever is stored; never blocks the brief.
    const storedReviews = (() => {
      try {
        const v = JSON.parse(lead.google_reviews ?? '[]');
        return Array.isArray(v) ? v.length : 0;
      } catch {
        return 0;
      }
    })();
    const listedReviews = lead.google_review_count ?? 0;
    const reviewRefreshTask: Promise<string | null> =
      c.env.OUTSCRAPER_API_KEY && lead.place_id && listedReviews > storedReviews
        ? (async () => {
            try {
              const extra = await fetchOutscraperReviews(
                c.env.OUTSCRAPER_API_KEY!,
                lead.place_id!,
                50,
              );
              if (extra.length === 0) return null;
              const existing: GoogleReview[] = (() => {
                try {
                  const v = JSON.parse(lead.google_reviews ?? '[]');
                  return Array.isArray(v) ? v : [];
                } catch {
                  return [];
                }
              })();
              const merged = JSON.stringify(mergeReviews(existing, extra));
              await c.env.DB.prepare(
                `UPDATE leads
                   SET google_reviews = ?, reviews_fetched_at = datetime('now')
                   WHERE id = ?`,
              )
                .bind(merged, id)
                .run();
              log('info', 'pipeline', `Lead ${id} review backfill for brief`, {
                before: storedReviews,
                after: JSON.parse(merged).length,
              });
              return merged;
            } catch (err) {
              log('warn', 'pipeline', `Review backfill failed for lead ${id}; using stored set`, err);
              return null;
            }
          })()
        : Promise.resolve(null);

    let briefText: string;
    let refreshedReviews: string | null;
    try {
      [briefText, refreshedReviews] = await Promise.all([
        callClaude(c.env.CLAUDE_API_KEY, prompt.user, {
          model: BRIEF_MODEL,
          systemPrompt: prompt.system,
          cacheSystem: true, // system prompt is stable; ephemeral cache pays off across leads in one session
          maxTokens: 1500,
          temperature: 0.6,
          timeoutMs: 45_000,
        }),
        reviewRefreshTask,
      ]);
    } catch (err) {
      log('error', 'pipeline', `Brief generation failed for lead ${id}`, err);
      const message = err instanceof Error ? err.message : 'Brief generation failed';
      return c.json(
        { error: `Brief generation failed: ${message}`, code: 'CLAUDE_ERROR' },
        502,
      );
    }

    briefText = briefText.trim();
    if (!briefText) {
      return c.json({ error: 'Claude returned an empty brief', code: 'CLAUDE_ERROR' }, 502);
    }

    // Despite the prompt rule, the model sometimes reproduces the review
    // set itself under its own CUSTOMER REVIEWS header, which would then
    // duplicate the appended block. Truncate at any model-authored reviews
    // header — the authored brief legitimately ends at CONSTRAINTS.
    const strayReviews = briefText.search(/^\s*(#+\s*)?CUSTOMER REVIEWS/m);
    if (strayReviews !== -1) {
      briefText = briefText.slice(0, strayReviews).replace(/[\s-]+$/, '');
    }

    // Append verbatim contact details, then the full verbatim review set,
    // below the authored brief so landingsite has exact values to build with.
    briefText = `${briefText}\n\n${formatVerbatimContact(lead)}`;
    briefText = `${briefText}\n\n${formatClarityInstallBlock(c.env, lead)}`;
    const reviewsBlock = formatVerbatimReviews(refreshedReviews ?? lead.google_reviews);
    if (reviewsBlock) {
      briefText = `${briefText}\n\n${reviewsBlock}`;
    }

    await c.env.DB.prepare(
      `UPDATE leads
         SET pipeline_brief = ?,
             updated_at = datetime('now')
         WHERE id = ?`,
    )
      .bind(briefText, id)
      .run();

    await writeActivity(c.env.DB, {
      leadId: id,
      action: 'brief_generated',
      meta: { model: BRIEF_MODEL, regenerated: !!body.regenerate },
    });

    const updated = await c.env.DB.prepare(`${PIPELINE_LEAD_SELECT} WHERE leads.id = ?`)
      .bind(id)
      .first<Lead>();
    log('info', 'pipeline', `Lead ${id} brief generated`, {
      chars: briefText.length,
      regenerated: !!body.regenerate,
    });
    return c.json({ lead: updated });
  } catch (err) {
    log('error', 'pipeline', 'POST /leads/:id/brief failed', err);
    return c.json(serverError(), 500);
  }
});

// ---------------------------------------------------------------------------
// POST /api/pipeline/leads/:id/undo
// ---------------------------------------------------------------------------
// Reverts the most recent reversible action. Restores prior pipeline_status
// if the action set one; for url_saved it also clears the site_url fields.
// Writes a matching 'undo' row so the audit trail stays intact. If there is
// nothing reversible to undo, returns 204 (idempotent no-op).
pipelineRouter.post('/leads/:id/undo', async (c) => {
  try {
    const id = parseInt(c.req.param('id'), 10);
    if (isNaN(id)) return c.json(badRequest('Invalid lead ID'), 400);
    const lead = await c.env.DB.prepare(
      'SELECT * FROM leads WHERE id = ? AND deleted_at IS NULL',
    )
      .bind(id)
      .first<Lead>();
    if (!lead) return c.json(notFound('Lead'), 404);

    // Walk backwards; skip 'undo' rows and non-reversible actions
    // (click_tracked, brief_generated, status_changed from external sources).
    const recent = await c.env.DB.prepare(
      `SELECT * FROM lead_activity
        WHERE lead_id = ?
        ORDER BY created_at DESC, id DESC
        LIMIT 10`,
    )
      .bind(id)
      .all<LeadActivityRow>();
    const undoneIds = new Set(
      (recent.results ?? [])
        .filter((row) => row.action === 'undo')
        .map((row) => {
          try {
            const parsed = row.meta ? JSON.parse(row.meta) as { undid_activity_id?: unknown } : null;
            return typeof parsed?.undid_activity_id === 'number' ? parsed.undid_activity_id : null;
          } catch {
            return null;
          }
        })
        .filter((id): id is number => id !== null),
    );
    const target = (recent.results ?? []).find(
      (row) => REVERSIBLE_ACTIONS.has(row.action) && !undoneIds.has(row.id),
    );
    if (!target) return c.body(null, 204);

    const sets: string[] = ["updated_at = datetime('now')"];
    const params: unknown[] = [];

    if (target.from_status) {
      sets.push('pipeline_status = ?');
      params.push(target.from_status);
    }
    if (target.action === 'url_saved') {
      // Roll back the URL + slug + clarity tag. The raw URL is dropped too
      // so the operator gets a clean paste-again experience.
      sets.push(
        'site_url = NULL',
        'site_url_raw = NULL',
        'campaign_slug = NULL',
        'clarity_tag = NULL',
      );
    }
    if (target.action === 'archived') {
      let previousLastAction: string | null = null;
      try {
        const parsed = target.meta ? JSON.parse(target.meta) as {
          previous_pipeline_last_action_at?: unknown;
        } : null;
        if (typeof parsed?.previous_pipeline_last_action_at === 'string') {
          previousLastAction = parsed.previous_pipeline_last_action_at;
        }
      } catch {
        // Older archive rows may not contain the timestamp snapshot.
      }
      if (!previousLastAction) {
        const previous = await c.env.DB.prepare(
          `SELECT created_at
             FROM lead_activity
            WHERE lead_id = ?
              AND id < ?
              AND action <> 'undo'
            ORDER BY id DESC
            LIMIT 1`,
        )
          .bind(id, target.id)
          .first<{ created_at: string }>();
        previousLastAction = previous?.created_at ?? null;
      }
      sets.push('pipeline_last_action_at = ?');
      params.push(previousLastAction);
    }
    if (target.action === 'reply_received') {
      try {
        const parsed = target.meta ? JSON.parse(target.meta) as {
          previous_engagement_score?: unknown;
          previous_engagement_grade?: unknown;
          previous_engagement_reasons?: unknown;
        } : null;
        sets.push(
          'engagement_score = ?',
          'engagement_grade = ?',
          'engagement_reasons = ?',
        );
        params.push(
          typeof parsed?.previous_engagement_score === 'number'
            ? parsed.previous_engagement_score
            : 0,
          typeof parsed?.previous_engagement_grade === 'string'
            ? parsed.previous_engagement_grade
            : 'nurture',
          typeof parsed?.previous_engagement_reasons === 'string'
            ? parsed.previous_engagement_reasons
            : null,
        );
      } catch {
        sets.push(
          'engagement_score = 0',
          "engagement_grade = 'nurture'",
          'engagement_reasons = NULL',
        );
      }
    }
    // pipeline_last_action_at is intentionally NOT rolled back to the prior
    // action's timestamp — showing "just now" is misleading, and showing the
    // previous action's time would require another lookup. The next real
    // action will overwrite it.

    params.push(id);
    await c.env.DB.prepare(`UPDATE leads SET ${sets.join(', ')} WHERE id = ?`)
      .bind(...params)
      .run();

    await writeActivity(c.env.DB, {
      leadId: id,
      action: 'undo',
      fromStatus: target.to_status,
      toStatus: target.from_status,
      meta: { undid_activity_id: target.id, undid_action: target.action },
    });

    const updated = await c.env.DB.prepare(`${PIPELINE_LEAD_SELECT} WHERE leads.id = ?`)
      .bind(id)
      .first<Lead>();
    log('info', 'pipeline', `Lead ${id} undo`, {
      undid: target.action,
      restored: target.from_status,
    });
    return c.json({ lead: updated });
  } catch (err) {
    log('error', 'pipeline', 'POST /leads/:id/undo failed', err);
    return c.json(serverError(), 500);
  }
});
