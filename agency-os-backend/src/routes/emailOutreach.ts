import { Hono } from 'hono';
import { Webhook } from 'svix';
import type { Env, Lead } from '../types';
import { badRequest, notFound, serverError, log } from '../utils/errors';
import {
  buildAutomationEmail,
  processDueEmailAutomations,
  publicOutreachUrl,
  scheduleEmailAutomation,
  sendOutreachEmail,
  validateOutreachRecipient,
  type AutomationRow,
  type EmailAutomationStep,
} from '../services/emailAutomation';

type EmailAction = 'email_sent' | 'email_followed_up' | 'email_final_touch';

interface SendBody {
  subject?: string;
  text?: string;
  templateKey?: string;
  action?: EmailAction;
}

interface ResendEvent {
  type: string;
  created_at: string;
  data: {
    email_id?: string;
    subject?: string;
    to?: string[];
    bounce?: { message?: string; type?: string; subType?: string };
    suppressed?: { message?: string; type?: string };
    failed?: { reason?: string };
  };
}

export const emailOutreachRouter = new Hono<{ Bindings: Env }>();
export const publicEmailRouter = new Hono<{ Bindings: Env }>();

emailOutreachRouter.post('/leads/:id/send', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id)) return c.json(badRequest('Invalid lead ID'), 400);
  const body = await c.req.json().catch(() => ({})) as SendBody;
  const subject = body.subject?.trim() ?? '';
  const text = body.text?.trim() ?? '';
  const action = body.action;
  if (!subject || !text || !action || !body.templateKey) {
    return c.json(badRequest('subject, text, templateKey, and action are required'), 400);
  }

  const lead = await c.env.DB.prepare(
    'SELECT * FROM leads WHERE id = ? AND deleted_at IS NULL',
  ).bind(id).first<Lead>();
  if (!lead) return c.json(notFound('Lead'), 404);
  if (!lead.email) return c.json(badRequest('Lead has no email address'), 400);
  const recipientError = validateOutreachRecipient(lead.email);
  if (recipientError) return c.json(badRequest(recipientError), 400);

  const allowed =
    (action === 'email_sent' && lead.pipeline_status === 'ready_to_send')
    || (
      (action === 'email_followed_up' || action === 'email_final_touch')
      && (lead.pipeline_status === 'sent_no_reply' || lead.pipeline_status === 'engaged')
    );
  if (!allowed) {
    return c.json(badRequest(`Cannot ${action} from ${lead.pipeline_status}`), 400);
  }

  try {
    const result = await sendOutreachEmail(c.env, lead, {
      subject,
      text,
      templateKey: body.templateKey,
      action,
    }, new URL(c.req.url).origin);
    return c.json({
      ok: true,
      sendId: result.sendId,
      providerMessageId: result.providerMessageId,
      status: 'sent',
      pipelineStatus: result.pipelineStatus,
    });
  } catch (err) {
    const message = (err as Error).message;
    log('error', 'email-outreach', `Send failed for lead ${id}`, err);
    return c.json(serverError(message), 500);
  }
});

emailOutreachRouter.get('/automations', async (c) => {
  try {
    const rows = await c.env.DB.prepare(`
      SELECT automation.*,
             lead.company, lead.email, lead.pipeline_status,
             lead.engagement_score, lead.engagement_grade,
             lead.pipeline_sessions, lead.site_url,
             initial_send.status AS initial_status,
             initial_send.sent_at AS initial_sent_at,
             initial_send.delivered_at AS initial_delivered_at,
             initial_send.opened_at AS initial_opened_at,
             initial_send.clicked_at AS initial_clicked_at,
             initial_send.provider_message_id AS initial_provider_message_id,
             followup_send.status AS followup_status,
             followup_send.sent_at AS followup_sent_at,
             followup_send.delivered_at AS followup_delivered_at,
             followup_send.opened_at AS followup_opened_at,
             followup_send.clicked_at AS followup_clicked_at,
             followup_send.provider_message_id AS followup_provider_message_id,
             final_send.status AS final_status,
             final_send.sent_at AS final_sent_at,
             final_send.delivered_at AS final_delivered_at,
             final_send.opened_at AS final_opened_at,
             final_send.clicked_at AS final_clicked_at,
             final_send.provider_message_id AS final_provider_message_id
        FROM email_automations automation
        JOIN leads lead ON lead.id = automation.lead_id
        LEFT JOIN email_sends initial_send ON initial_send.id = automation.initial_send_id
        LEFT JOIN email_sends followup_send ON followup_send.id = automation.followup_send_id
        LEFT JOIN email_sends final_send ON final_send.id = automation.final_send_id
       WHERE lead.deleted_at IS NULL
       ORDER BY
         CASE automation.status WHEN 'active' THEN 0 WHEN 'paused' THEN 1 WHEN 'failed' THEN 2 ELSE 3 END,
         automation.next_run_at ASC,
         automation.updated_at DESC
       LIMIT 500
    `).all();
    return c.json({ automations: rows.results ?? [] });
  } catch (err) {
    log('error', 'email-outreach', 'Could not list automations', err);
    return c.json(serverError(), 500);
  }
});

emailOutreachRouter.get('/leads/:id/automation', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id)) return c.json(badRequest('Invalid lead ID'), 400);
  const automation = await c.env.DB.prepare(
    'SELECT * FROM email_automations WHERE lead_id = ?',
  ).bind(id).first<AutomationRow>();
  if (!automation) return c.json(notFound('Email automation'), 404);
  const lead = await c.env.DB.prepare(
    'SELECT * FROM leads WHERE id = ? AND deleted_at IS NULL',
  ).bind(id).first<Lead>();
  if (!lead) return c.json(notFound('Lead'), 404);
  const sends = await c.env.DB.prepare(`
    SELECT * FROM email_sends WHERE lead_id = ? ORDER BY id ASC
  `).bind(id).all();
  const events = await c.env.DB.prepare(`
    SELECT event.* FROM email_events event
    JOIN email_sends send ON send.id = event.email_send_id
    WHERE send.lead_id = ?
    ORDER BY event.event_at ASC, event.id ASC
  `).bind(id).all();
  const nextTemplate = templateForStep(lead, automation.current_step, automation.branch, publicOutreachUrl(c.env, new URL(c.req.url).origin));
  return c.json({ automation, lead, sends: sends.results ?? [], events: events.results ?? [], nextTemplate });
});

emailOutreachRouter.post('/leads/:id/automation/start', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id)) return c.json(badRequest('Invalid lead ID'), 400);
  const lead = await c.env.DB.prepare(
    'SELECT email, pipeline_status FROM leads WHERE id = ? AND deleted_at IS NULL',
  ).bind(id).first<{ email: string | null; pipeline_status: string }>();
  if (!lead) return c.json(notFound('Lead'), 404);
  if (!lead.email) return c.json(badRequest('Lead requires an email address'), 400);
  if (lead.pipeline_status !== 'ready_to_send') {
    return c.json(badRequest('The demo site must be approved before email automation can start'), 400);
  }
  const recipientError = validateOutreachRecipient(lead.email);
  if (recipientError) return c.json(badRequest(recipientError), 400);
  const scheduled = await scheduleEmailAutomation(c.env, id);
  if (!scheduled) return c.json(badRequest('Lead requires both an email and site URL'), 400);
  const automation = await c.env.DB.prepare(
    'SELECT * FROM email_automations WHERE lead_id = ?',
  ).bind(id).first();
  return c.json({ automation });
});

emailOutreachRouter.post('/automations/:id/action', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id)) return c.json(badRequest('Invalid automation ID'), 400);
  const body = await c.req.json().catch(() => ({})) as {
    action?:
      | 'pause'
      | 'resume'
      | 'send_now'
      | 'skip'
      | 'stop'
      | 'return_to_call'
      | 'undo_return_to_call'
      | 'extend_review'
      | 'archive';
  };
  const automation = await c.env.DB.prepare(
    'SELECT * FROM email_automations WHERE id = ?',
  ).bind(id).first<AutomationRow>();
  if (!automation) return c.json(notFound('Email automation'), 404);

  if (body.action === 'pause') {
    await c.env.DB.prepare(`
      UPDATE email_automations SET status = 'paused', paused_at = datetime('now'),
        processing_at = NULL, updated_at = datetime('now') WHERE id = ?
    `).bind(id).run();
  } else if (body.action === 'resume') {
    await c.env.DB.prepare(`
      UPDATE email_automations SET status = 'active', paused_at = NULL,
        current_step = CASE
          WHEN status = 'failed' AND initial_send_id IS NULL THEN 'review_wait'
          ELSE current_step
        END,
        next_run_at = COALESCE(next_run_at, datetime('now')),
        processing_at = NULL, last_error = NULL,
        updated_at = datetime('now') WHERE id = ?
    `).bind(id).run();
  } else if (body.action === 'send_now') {
    if (automation.status !== 'active') {
      await c.env.DB.prepare(`
        UPDATE email_automations SET status = 'active', paused_at = NULL,
          current_step = CASE
            WHEN status = 'failed' AND initial_send_id IS NULL THEN 'review_wait'
            ELSE current_step
          END,
          processing_at = NULL, next_run_at = datetime('now'), last_error = NULL,
          updated_at = datetime('now')
        WHERE id = ?
      `).bind(id).run();
    }
    const result = await processDueEmailAutomations(c.env, {
      automationId: id,
      force: true,
      limit: 1,
      publicOrigin: new URL(c.req.url).origin,
    });
    return c.json({ ok: true, result });
  } else if (body.action === 'skip') {
    await c.env.DB.prepare(`
      UPDATE email_automations
         SET next_run_at = datetime('now'), processing_at = NULL,
             updated_at = datetime('now')
       WHERE id = ?
    `).bind(id).run();
  } else if (body.action === 'stop') {
    await c.env.DB.prepare(`
      UPDATE email_automations
         SET status = 'stopped', stopped_at = datetime('now'), next_run_at = NULL,
             processing_at = NULL, updated_at = datetime('now')
       WHERE id = ?
      `).bind(id).run();
  } else if (body.action === 'extend_review') {
    await c.env.DB.batch([
      c.env.DB.prepare(`
        UPDATE email_automations
           SET status = 'active', next_run_at = datetime('now', '+3 days'),
               processing_at = NULL, paused_at = NULL, updated_at = datetime('now')
         WHERE id = ? AND current_step = 'archive_wait'
      `).bind(id),
      c.env.DB.prepare(`
        UPDATE leads
           SET outcome = 'Awaiting Final Review', updated_at = datetime('now')
         WHERE id = ?
      `).bind(automation.lead_id),
      c.env.DB.prepare(`
        INSERT INTO lead_activity (lead_id, action, from_status, to_status, meta)
        VALUES (?, 'email_review_extended', NULL, NULL, ?)
      `).bind(automation.lead_id, JSON.stringify({ days: 3 })),
    ]);
  } else if (body.action === 'archive') {
    await c.env.DB.batch([
      c.env.DB.prepare(`
        UPDATE email_automations
           SET status = 'completed', current_step = 'complete',
               completed_at = datetime('now'), next_run_at = NULL,
               processing_at = NULL, updated_at = datetime('now')
         WHERE id = ?
      `).bind(id),
      c.env.DB.prepare(`
        UPDATE leads
           SET pipeline_status = 'archived', outcome = 'Archived after Final Review',
               pipeline_last_action_at = datetime('now'), updated_at = datetime('now')
         WHERE id = ?
      `).bind(automation.lead_id),
      c.env.DB.prepare(`
        INSERT INTO lead_activity (lead_id, action, from_status, to_status, meta)
        VALUES (?, 'archived', ?, 'archived', ?)
      `).bind(
        automation.lead_id,
        'sent_no_reply',
        JSON.stringify({ source: 'email_final_review', operator_confirmed: true }),
      ),
    ]);
  } else if (body.action === 'return_to_call') {
    const leadState = await c.env.DB.prepare(`
      SELECT pipeline_status, outcome, pipeline_last_action_at
        FROM leads
       WHERE id = ?
    `).bind(automation.lead_id).first<{
      pipeline_status: string;
      outcome: string | null;
      pipeline_last_action_at: string | null;
    }>();
    if (!leadState) return c.json(notFound('Lead'), 404);
    const restoreState = {
      automation_id: id,
      previous_status: automation.status,
      previous_current_step: automation.current_step,
      previous_next_run_at: automation.next_run_at,
      previous_paused_at: automation.paused_at,
      previous_stopped_at: automation.stopped_at,
      previous_pipeline_status: leadState.pipeline_status,
      previous_outcome: leadState.outcome,
      previous_pipeline_last_action_at: leadState.pipeline_last_action_at,
      reason: 'returned_to_final_review',
    };
    await c.env.DB.batch([
      c.env.DB.prepare(`
        UPDATE email_automations
           SET status = 'stopped', stopped_at = datetime('now'), next_run_at = NULL,
               processing_at = NULL, updated_at = datetime('now')
         WHERE id = ?
      `).bind(id),
      c.env.DB.prepare(`
        UPDATE leads
           SET pipeline_status = 'sent_no_reply', outcome = 'Final Review',
               pipeline_last_action_at = datetime('now'),
               updated_at = datetime('now')
         WHERE id = ?
      `).bind(automation.lead_id),
      c.env.DB.prepare(`
        INSERT INTO lead_activity (lead_id, action, from_status, to_status, meta)
        VALUES (?, 'automation_stopped', ?, 'sent_no_reply', ?)
      `).bind(
        automation.lead_id,
        leadState.pipeline_status,
        JSON.stringify(restoreState),
      ),
    ]);
  } else if (body.action === 'undo_return_to_call') {
    const activity = await c.env.DB.prepare(`
      SELECT id, meta
        FROM lead_activity AS stopped
       WHERE stopped.lead_id = ?
         AND stopped.action = 'automation_stopped'
         AND json_extract(stopped.meta, '$.automation_id') = ?
         AND stopped.created_at >= datetime('now', '-15 seconds')
         AND NOT EXISTS (
           SELECT 1
             FROM lead_activity AS undo
            WHERE undo.action = 'undo'
              AND json_extract(undo.meta, '$.undid_activity_id') = stopped.id
         )
       ORDER BY stopped.id DESC
       LIMIT 1
    `).bind(automation.lead_id, id).first<{ id: number; meta: string | null }>();
    if (!activity?.meta) {
      return c.json(badRequest('The 15-second undo window has expired'), 409);
    }
    const restore = JSON.parse(activity.meta) as {
      previous_status: AutomationRow['status'];
      previous_current_step: AutomationRow['current_step'];
      previous_next_run_at: string | null;
      previous_paused_at: string | null;
      previous_stopped_at: string | null;
      previous_pipeline_status: string;
      previous_outcome: string | null;
      previous_pipeline_last_action_at: string | null;
    };
    await c.env.DB.batch([
      c.env.DB.prepare(`
        UPDATE email_automations
           SET status = ?, current_step = ?, next_run_at = ?, paused_at = ?,
               stopped_at = ?, processing_at = NULL, updated_at = datetime('now')
         WHERE id = ?
      `).bind(
        restore.previous_status,
        restore.previous_current_step,
        restore.previous_next_run_at,
        restore.previous_paused_at,
        restore.previous_stopped_at,
        id,
      ),
      c.env.DB.prepare(`
        UPDATE leads
           SET pipeline_status = ?, outcome = ?, pipeline_last_action_at = ?,
               updated_at = datetime('now')
         WHERE id = ?
      `).bind(
        restore.previous_pipeline_status,
        restore.previous_outcome,
        restore.previous_pipeline_last_action_at,
        automation.lead_id,
      ),
      c.env.DB.prepare(`
        INSERT INTO lead_activity (lead_id, action, from_status, to_status, meta)
        VALUES (?, 'undo', 'sent_no_reply', ?, ?)
      `).bind(
        automation.lead_id,
        restore.previous_pipeline_status,
        JSON.stringify({
          undid_activity_id: activity.id,
          undid_action: 'automation_stopped',
          source: 'return_to_final_review',
        }),
      ),
    ]);
  } else {
    return c.json(badRequest('Unknown automation action'), 400);
  }

  const updated = await c.env.DB.prepare(
    'SELECT * FROM email_automations WHERE id = ?',
  ).bind(id).first();
  return c.json({ ok: true, automation: updated });
});

emailOutreachRouter.put('/automations/:id/scheduled-email', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id)) return c.json(badRequest('Invalid automation ID'), 400);
  const body = await c.req.json().catch(() => ({})) as { subject?: string; text?: string };
  if (!body.subject?.trim() || !body.text?.trim()) {
    return c.json(badRequest('subject and text are required'), 400);
  }
  await c.env.DB.prepare(`
    UPDATE email_automations
       SET pending_subject = ?, pending_text = ?, updated_at = datetime('now')
     WHERE id = ?
  `).bind(body.subject.trim(), body.text.trim(), id).run();
  const updated = await c.env.DB.prepare(
    'SELECT * FROM email_automations WHERE id = ?',
  ).bind(id).first();
  if (!updated) return c.json(notFound('Email automation'), 404);
  return c.json({ automation: updated });
});

emailOutreachRouter.post('/automations/run-due', async (c) => {
  const result = await processDueEmailAutomations(c.env, {
    publicOrigin: new URL(c.req.url).origin,
  });
  return c.json(result);
});

publicEmailRouter.get('/email/open/:token', async (c) => {
  const token = c.req.param('token').replace(/\.gif$/, '');
  const send = await c.env.DB.prepare(
    'SELECT id, lead_id, opened_at, status FROM email_sends WHERE open_token = ?',
  ).bind(token).first<{ id: number; lead_id: number; opened_at: string | null; status: string }>();
  if (send && !send.opened_at) {
    const now = new Date().toISOString();
    await c.env.DB.batch([
      c.env.DB.prepare(`
        UPDATE email_sends
           SET opened_at = ?, status = CASE
             WHEN status IN ('bounced', 'complained', 'suppressed', 'failed') THEN status
             ELSE 'opened' END,
             updated_at = datetime('now')
         WHERE id = ? AND opened_at IS NULL
      `).bind(now, send.id),
      c.env.DB.prepare(`
        INSERT OR IGNORE INTO email_events (
          email_send_id, event_key, event_type, event_at, payload
        ) VALUES (?, ?, 'first_party.opened', ?, ?)
      `).bind(send.id, `pixel:${send.id}:opened`, now, JSON.stringify({ user_agent: c.req.header('user-agent') })),
      c.env.DB.prepare(`
        INSERT INTO lead_activity (lead_id, action, from_status, to_status, meta)
        VALUES (?, 'email_opened', NULL, NULL, ?)
      `).bind(send.lead_id, JSON.stringify({ email_send_id: send.id })),
      c.env.DB.prepare(`
        UPDATE leads
           SET engagement_score = MAX(engagement_score, 10),
               engagement_grade = CASE
                 WHEN MAX(engagement_score, 10) >= 90 THEN 'hot'
                 WHEN MAX(engagement_score, 10) >= 70 THEN 'walkthrough'
                 WHEN MAX(engagement_score, 10) >= 40 THEN 'follow_up'
                 ELSE 'nurture'
               END,
               engagement_reasons = CASE
                 WHEN COALESCE(engagement_reasons, '') LIKE '%opened outreach email%'
                   THEN engagement_reasons
                 WHEN json_valid(engagement_reasons)
                   THEN json_insert(engagement_reasons, '$[#]', '+10 opened outreach email')
                 ELSE json_array('+10 opened outreach email')
               END,
               pipeline_last_action_at = ?,
               updated_at = datetime('now')
         WHERE id = ?
      `).bind(now, send.lead_id),
    ]);
  }
  const bytes = Uint8Array.from(atob('R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs='), ch => ch.charCodeAt(0));
  return new Response(bytes, {
    headers: {
      'Content-Type': 'image/gif',
      'Content-Length': String(bytes.length),
      'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
    },
  });
});

publicEmailRouter.post('/webhooks/resend', async (c) => {
  const secret = c.env.RESEND_WEBHOOK_SECRET;
  if (!secret) return c.text('Webhook not configured', 503);
  const raw = await c.req.text();
  const id = c.req.header('svix-id');
  const timestamp = c.req.header('svix-timestamp');
  const signature = c.req.header('svix-signature');
  if (!id || !timestamp || !signature) return c.text('Missing signature', 400);

  let event: ResendEvent;
  try {
    event = new Webhook(secret).verify(raw, {
      'svix-id': id,
      'svix-timestamp': timestamp,
      'svix-signature': signature,
    }) as ResendEvent;
  } catch {
    return c.text('Invalid signature', 400);
  }

  const providerId = event.data.email_id ?? null;
  const send = providerId
    ? await c.env.DB.prepare(
      'SELECT id, lead_id FROM email_sends WHERE provider_message_id = ?',
    ).bind(providerId).first<{ id: number; lead_id: number }>()
    : null;
  const inserted = await c.env.DB.prepare(`
    INSERT OR IGNORE INTO email_events (
      email_send_id, provider_message_id, event_key, event_type, event_at, payload
    ) VALUES (?, ?, ?, ?, ?, ?)
  `).bind(
    send?.id ?? null, providerId, id, event.type, event.created_at, raw,
  ).run();
  if (!inserted.meta.changes || !send) return c.json({ ok: true });

  const mapped = webhookStatus(event.type);
  if (mapped) {
    const timeColumn = {
      delivered: 'delivered_at',
      opened: 'opened_at',
      clicked: 'clicked_at',
      bounced: 'bounced_at',
      complained: 'complained_at',
      failed: 'failed_at',
      suppressed: 'failed_at',
      delivery_delayed: 'updated_at',
    }[mapped];
    const error = event.data.bounce?.message
      ?? event.data.suppressed?.message
      ?? event.data.failed?.reason
      ?? null;
    await c.env.DB.prepare(`
      UPDATE email_sends
         SET status = ?, ${timeColumn} = ?, last_error = COALESCE(?, last_error),
             updated_at = datetime('now')
       WHERE id = ?
    `).bind(mapped, event.created_at, error, send.id).run();
    if (['delivered', 'bounced', 'complained', 'failed', 'suppressed'].includes(mapped)) {
      await c.env.DB.prepare(`
        INSERT INTO lead_activity (lead_id, action, from_status, to_status, meta)
        VALUES (?, ?, NULL, NULL, ?)
      `).bind(send.lead_id, `email_${mapped}`, JSON.stringify({
        email_send_id: send.id,
        provider_message_id: providerId,
        error,
      })).run();
    }
    if (mapped === 'opened') {
      await applyEmailOpenScore(c.env, send.lead_id, send.id, event.created_at);
    } else if (mapped === 'clicked') {
      await applyEmailClickScore(c.env, send.lead_id, send.id, event.created_at);
    } else if (['bounced', 'complained', 'failed', 'suppressed'].includes(mapped)) {
      await c.env.DB.prepare(`
        UPDATE email_automations
           SET status = 'failed', next_run_at = NULL, processing_at = NULL,
               last_error = ?, updated_at = datetime('now')
         WHERE lead_id = ? AND status IN ('active', 'paused')
      `).bind(error || `Email ${mapped}`, send.lead_id).run();
    }
  }
  return c.json({ ok: true });
});

function webhookStatus(type: string): string | null {
  return ({
    'email.sent': 'sent',
    'email.delivered': 'delivered',
    'email.delivery_delayed': 'delivery_delayed',
    'email.opened': 'opened',
    'email.clicked': 'clicked',
    'email.bounced': 'bounced',
    'email.complained': 'complained',
    'email.failed': 'failed',
    'email.suppressed': 'suppressed',
  } as Record<string, string>)[type] ?? null;
}

function templateForStep(
  lead: Lead,
  step: EmailAutomationStep,
  branch: AutomationRow['branch'],
  publicUrl: string,
) {
  if (step === 'review_wait') return buildAutomationEmail(lead, 'stage_1', publicUrl);
  if (step === 'signal_wait') {
    return buildAutomationEmail(
      lead,
      branch === 'opened_no_click' ? 'stage_3_opened' : 'stage_2_no_open',
      publicUrl,
    );
  }
  if (step === 'final_wait') return buildAutomationEmail(lead, 'stage_5_final', publicUrl);
  return null;
}

async function applyEmailOpenScore(
  env: Env,
  leadId: number,
  sendId: number,
  at: string,
): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(`
      UPDATE leads
         SET engagement_score = MAX(engagement_score, 10),
             engagement_grade = CASE
               WHEN MAX(engagement_score, 10) >= 90 THEN 'hot'
               WHEN MAX(engagement_score, 10) >= 70 THEN 'walkthrough'
               WHEN MAX(engagement_score, 10) >= 40 THEN 'follow_up'
               ELSE 'nurture'
             END,
             engagement_reasons = CASE
               WHEN COALESCE(engagement_reasons, '') LIKE '%opened outreach email%'
                 THEN engagement_reasons
               WHEN json_valid(engagement_reasons)
                 THEN json_insert(engagement_reasons, '$[#]', '+10 opened outreach email')
               ELSE json_array('+10 opened outreach email')
             END,
             pipeline_last_action_at = ?,
             updated_at = datetime('now')
       WHERE id = ?
    `).bind(at, leadId),
    env.DB.prepare(`
      INSERT INTO lead_activity (lead_id, action, from_status, to_status, meta)
      SELECT ?, 'email_opened', NULL, NULL, ?
       WHERE NOT EXISTS (
         SELECT 1 FROM lead_activity
          WHERE lead_id = ? AND action = 'email_opened'
            AND json_extract(meta, '$.email_send_id') = ?
       )
    `).bind(leadId, JSON.stringify({ email_send_id: sendId }), leadId, sendId),
  ]);
}

async function applyEmailClickScore(
  env: Env,
  leadId: number,
  sendId: number,
  at: string,
): Promise<void> {
  const lead = await env.DB.prepare(
    'SELECT pipeline_status FROM leads WHERE id = ?',
  ).bind(leadId).first<{ pipeline_status: string }>();
  if (!lead) return;
  const nextStatus = lead.pipeline_status === 'sent_no_reply' ? 'engaged' : lead.pipeline_status;
  await env.DB.batch([
    env.DB.prepare(`
      UPDATE leads
         SET pipeline_status = ?,
             engagement_score = MAX(engagement_score, 40),
             engagement_grade = CASE
               WHEN MAX(engagement_score, 40) >= 90 THEN 'hot'
               WHEN MAX(engagement_score, 40) >= 70 THEN 'walkthrough'
               ELSE 'follow_up'
             END,
             engagement_reasons = CASE
               WHEN COALESCE(engagement_reasons, '') LIKE '%clicked tracked email link%'
                 THEN engagement_reasons
               WHEN json_valid(engagement_reasons)
                 THEN json_insert(engagement_reasons, '$[#]', '+40 clicked tracked email link')
               ELSE json_array('+40 clicked tracked email link')
             END,
             pipeline_last_action_at = ?,
             updated_at = datetime('now')
       WHERE id = ?
    `).bind(nextStatus, at, leadId),
    env.DB.prepare(`
      INSERT INTO lead_activity (lead_id, action, from_status, to_status, meta)
      VALUES (?, 'email_clicked', ?, ?, ?)
    `).bind(
      leadId,
      lead.pipeline_status,
      nextStatus !== lead.pipeline_status ? nextStatus : null,
      JSON.stringify({ email_send_id: sendId }),
    ),
    env.DB.prepare(`
      UPDATE email_automations
         SET status = 'completed', current_step = 'complete', branch = 'demo_clicked',
             completed_at = datetime('now'), next_run_at = NULL,
             processing_at = NULL, updated_at = datetime('now')
       WHERE lead_id = ? AND status IN ('active', 'paused')
    `).bind(leadId),
  ]);
}
