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
  'intro_sent',
  'followed_up',
  'called',
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
function tagUrl(rawUrl: string, slug: string): string {
  const sep = rawUrl.includes('?') ? '&' : '?';
  return `${rawUrl}${sep}utm_source=sms&utm_medium=text&utm_campaign=${encodeURIComponent(slug)}`;
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
//   - enriched (need reviews/hours/etc. to build a brief)
//   - no existing website (the whole thesis: build them one)
// Ordered by opportunity_score DESC so the highest-signal leads surface first.
// Optional query params: ?status=<pipeline_status>&q=<name search>
pipelineRouter.get('/leads', async (c) => {
  try {
    const { status, q } = c.req.query();
    const clauses: string[] = [
      'deleted_at IS NULL',
      "status IN ('cold', 'contacted')",
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
    const sql = `SELECT * FROM leads
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
    // Loose validation — landingsite URLs vary; just make sure it parses.
    try {
      // eslint-disable-next-line no-new
      new URL(rawUrl);
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

    const slug = slugify(lead.company || `lead-${lead.id}`);
    const tagged = tagUrl(rawUrl, slug);

    await c.env.DB.prepare(
      `UPDATE leads
         SET site_url = ?,
             site_url_raw = ?,
             campaign_slug = ?,
             clarity_tag = ?,
             pipeline_status = 'ready_to_send',
             pipeline_last_action_at = datetime('now'),
             updated_at = datetime('now')
         WHERE id = ?`,
    )
      .bind(tagged, rawUrl, slug, `lead-${lead.id}`, id)
      .run();

    await writeActivity(c.env.DB, {
      leadId: id,
      action: 'url_saved',
      fromStatus: 'awaiting_build',
      toStatus: 'ready_to_send',
      meta: { url: tagged, raw_url: rawUrl },
    });

    const updated = await c.env.DB.prepare('SELECT * FROM leads WHERE id = ?')
      .bind(id)
      .first<Lead>();
    log('info', 'pipeline', `Lead ${id} URL saved`, { slug });
    return c.json({ lead: updated });
  } catch (err) {
    log('error', 'pipeline', 'POST /leads/:id/site-url failed', err);
    return c.json(serverError(), 500);
  }
});

// ---------------------------------------------------------------------------
// POST /api/pipeline/leads/:id/action
// ---------------------------------------------------------------------------
// Body: { action: 'intro_sent' | 'followed_up' | 'called', meta?: unknown }
// Applies the (optional) status transition, updates the last-action pointer,
// writes an activity row. Optimistic: the client fires this on tap of
// "Open in Messages" even though we can't confirm the operator actually
// sent — /undo lets them recover.
type OutreachAction = 'intro_sent' | 'followed_up' | 'called';

const ACTION_TRANSITIONS: Record<
  OutreachAction,
  { from?: PipelineStatus[]; to?: PipelineStatus }
> = {
  intro_sent: { from: ['ready_to_send'], to: 'sent_no_reply' },
  followed_up: {}, // no status change — stays in sent_no_reply or engaged
  called: {}, // no status change — display-only
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

    const fromStatus = lead.pipeline_status;
    const toStatus = rules.to ?? fromStatus;
    const sets = ["pipeline_last_action_at = datetime('now')", "updated_at = datetime('now')"];
    const params: unknown[] = [];
    if (rules.to) {
      sets.push('pipeline_status = ?');
      params.push(rules.to);
    }
    params.push(id);
    await c.env.DB.prepare(`UPDATE leads SET ${sets.join(', ')} WHERE id = ?`)
      .bind(...params)
      .run();

    await writeActivity(c.env.DB, {
      leadId: id,
      action,
      fromStatus,
      toStatus,
      meta: body.meta,
    });

    const updated = await c.env.DB.prepare('SELECT * FROM leads WHERE id = ?')
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
    const target = (recent.results ?? []).find((r) => REVERSIBLE_ACTIONS.has(r.action));
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

    const updated = await c.env.DB.prepare('SELECT * FROM leads WHERE id = ?')
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
