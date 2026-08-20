import type { Env, Lead } from '../types';
import { log } from '../utils/errors';
import { sendEmail } from './email';

export type EmailAutomationStep =
  | 'review_wait'
  | 'signal_wait'
  | 'final_wait'
  | 'archive_wait'
  | 'complete';

export type EmailAutomationStatus =
  | 'active'
  | 'paused'
  | 'completed'
  | 'stopped'
  | 'failed';

export type EmailTemplateKey =
  | 'stage_1'
  | 'stage_2_no_open'
  | 'stage_3_opened'
  | 'stage_5_final';

export type EmailOutreachAction =
  | 'email_sent'
  | 'email_followed_up'
  | 'email_final_touch';

export interface AutomationRow {
  id: number;
  lead_id: number;
  status: EmailAutomationStatus;
  current_step: EmailAutomationStep;
  branch: 'no_open' | 'opened_no_click' | 'demo_clicked' | null;
  next_run_at: string | null;
  processing_at: string | null;
  initial_send_id: number | null;
  followup_send_id: number | null;
  final_send_id: number | null;
  pending_subject: string | null;
  pending_text: string | null;
  paused_at: string | null;
  completed_at: string | null;
  stopped_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface EmailContent {
  subject: string;
  text: string;
  templateKey: EmailTemplateKey | string;
  action: EmailOutreachAction;
}

const REVIEW_DELAY_MINUTES = 10;
const SIGNAL_WAIT_HOURS = 48;
const FINAL_WAIT_DAYS = 5;
const ARCHIVE_WAIT_DAYS = 3;

export function publicOutreachUrl(env: Env, fallback?: string): string {
  return (fallback || env.OUTREACH_PUBLIC_URL || '').replace(/\/+$/, '');
}

export function buildAutomationEmail(
  lead: Lead,
  key: EmailTemplateKey,
  publicUrl: string,
): EmailContent {
  const firstName = lead.contact?.trim().split(/\s+/)[0] || 'there';
  const business = lead.company;
  const demoLink = `${publicUrl}/r/${lead.id}?channel=email`;
  const signature = 'Thanks,\nShaun Gehrke\nShaun Carl Designs';

  if (key === 'stage_1') {
    return {
      templateKey: key,
      action: 'email_sent',
      subject: `I built something for ${business}`,
      text: `Hi ${firstName},

Thanks again for taking a minute to speak with me today.

As promised, I put together a website concept specifically for ${business}. It's not live, and there's no obligation—I simply wanted to show you what your online presence could look like if it matched the reputation you've already built.

You can view it here:

${demoLink}

I'm genuinely curious...

What stood out?

Even if it's just one thing you like—or one thing you'd change—I’d love to hear your thoughts.

${signature}`,
    };
  }

  if (key === 'stage_2_no_open') {
    return {
      templateKey: key,
      action: 'email_followed_up',
      subject: 'Just making sure you saw it',
      text: `Hi ${firstName},

Just wanted to make sure the demo site I built for ${business} didn't get buried in your inbox.

Here's the link again:

${demoLink}

I'm not expecting a decision—I’m honestly just curious what you think.

What did you like?

What would you change?

I'd appreciate any feedback.

${signature}`,
    };
  }

  if (key === 'stage_3_opened') {
    return {
      templateKey: key,
      action: 'email_followed_up',
      subject: 'Curious what your first impression was',
      text: `Hi ${firstName},

I noticed you had a chance to take a quick look at the website concept.

I'm curious...

Was there anything that stood out?

Or was there something that immediately made you think, “I'd want this changed.”

I'm always looking to improve these demos, so I'd appreciate the feedback.

${signature}`,
    };
  }

  return {
    templateKey: key,
    action: 'email_final_touch',
    subject: 'Should I archive it?',
    text: `Hi ${firstName},

Just wanted to check in one last time before I remove the website concept I built for ${business}.

If now isn't the right time, that's completely okay.

If you'd still like to take a look, here's the link again:

${demoLink}

Either way, thanks for taking a few minutes to talk with me.

Have a great week.

${signature}`,
  };
}

export async function sendOutreachEmail(
  env: Env,
  lead: Lead,
  content: EmailContent,
  pixelOrigin: string,
): Promise<{ sendId: number; providerMessageId: string; pipelineStatus: string }> {
  if (!lead.email) throw new Error('Lead has no email address');
  const recipientError = validateOutreachRecipient(lead.email);
  if (recipientError) throw new Error(recipientError);
  const from = env.OUTREACH_EMAIL_FROM?.trim();
  const replyTo = env.OUTREACH_EMAIL_REPLY_TO?.trim();
  if (!from) throw new Error('OUTREACH_EMAIL_FROM not configured');

  const openToken = crypto.randomUUID().replaceAll('-', '');
  const pixelUrl = `${pixelOrigin.replace(/\/+$/, '')}/email/open/${openToken}.gif`;
  const html = renderEmailHtml(content.text, pixelUrl);
  const pending = await env.DB.prepare(`
    INSERT INTO email_sends (
      lead_id, open_token, recipient, sender, reply_to, subject,
      template_key, text_body, html_body, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
    RETURNING id
  `).bind(
    lead.id,
    openToken,
    lead.email,
    from,
    replyTo ?? null,
    content.subject,
    content.templateKey,
    content.text,
    html,
  ).first<{ id: number }>();
  if (!pending) throw new Error('Could not create email send record');

  try {
    const result = await sendEmail(env.RESEND_API_KEY, {
      to: lead.email,
      from,
      replyTo,
      subject: content.subject,
      text: content.text,
      html,
      tags: [
        { name: 'lead_id', value: String(lead.id) },
        { name: 'template', value: content.templateKey.replace(/[^a-zA-Z0-9_-]/g, '_') },
      ],
    });
    const toStatus = content.action === 'email_sent'
      ? 'sent_no_reply'
      : lead.pipeline_status;
    await env.DB.batch([
      env.DB.prepare(`
        UPDATE email_sends
           SET provider_message_id = ?, status = 'sent', sent_at = datetime('now'),
               updated_at = datetime('now')
         WHERE id = ?
      `).bind(result.id, pending.id),
      env.DB.prepare(`
        UPDATE leads
           SET pipeline_status = ?, pipeline_last_action_at = datetime('now'),
               updated_at = datetime('now')
         WHERE id = ?
      `).bind(toStatus, lead.id),
      env.DB.prepare(`
        INSERT INTO lead_activity (lead_id, action, from_status, to_status, meta)
        VALUES (?, ?, ?, ?, ?)
      `).bind(lead.id, content.action, lead.pipeline_status, toStatus, JSON.stringify({
        channel: 'email',
        template: content.templateKey,
        subject: content.subject,
        body: content.text,
        provider_message_id: result.id,
        email_send_id: pending.id,
      })),
    ]);
    return {
      sendId: pending.id,
      providerMessageId: result.id,
      pipelineStatus: toStatus,
    };
  } catch (error) {
    const message = (error as Error).message;
    await env.DB.batch([
      env.DB.prepare(`
        UPDATE email_sends
           SET status = 'failed', failed_at = datetime('now'), last_error = ?,
               updated_at = datetime('now')
         WHERE id = ?
      `).bind(message.slice(0, 1000), pending.id),
      env.DB.prepare(`
        INSERT INTO lead_activity (lead_id, action, from_status, to_status, meta)
        VALUES (?, 'email_failed', ?, NULL, ?)
      `).bind(lead.id, lead.pipeline_status, JSON.stringify({
        email_send_id: pending.id,
        error: message.slice(0, 1000),
      })),
    ]);
    throw error;
  }
}

export async function scheduleEmailAutomation(env: Env, leadId: number): Promise<boolean> {
  const lead = await env.DB.prepare(`
    SELECT * FROM leads
     WHERE id = ? AND deleted_at IS NULL
       AND pipeline_status = 'ready_to_send'
       AND email IS NOT NULL AND trim(email) <> ''
       AND site_url IS NOT NULL AND trim(site_url) <> ''
  `).bind(leadId).first<Lead>();
  if (!lead) return false;
  if (validateOutreachRecipient(lead.email!)) return false;
  const existingInitial = await env.DB.prepare(`
    SELECT id, sent_at FROM email_sends
     WHERE lead_id = ? AND template_key = 'stage_1'
       AND status NOT IN ('pending', 'failed', 'bounced', 'complained', 'suppressed')
     ORDER BY id DESC LIMIT 1
  `).bind(leadId).first<{ id: number; sent_at: string | null }>();
  const initialId = existingInitial?.id ?? null;
  const initialNextRun = existingInitial?.sent_at
    ? new Date(new Date(existingInitial.sent_at.replace(' ', 'T') + 'Z').getTime() + SIGNAL_WAIT_HOURS * 3_600_000).toISOString()
    : null;

  await env.DB.prepare(`
    INSERT INTO email_automations (
      lead_id, status, current_step, next_run_at, initial_send_id, last_error
    ) VALUES (?, 'active', ?, COALESCE(?, datetime('now', ?)), ?, NULL)
    ON CONFLICT(lead_id) DO UPDATE SET
      status = CASE
        WHEN email_automations.status IN ('completed', 'stopped') THEN email_automations.status
        ELSE 'active'
      END,
      next_run_at = CASE
        WHEN email_automations.initial_send_id IS NULL
          THEN datetime('now', ?)
        ELSE email_automations.next_run_at
      END,
      paused_at = NULL,
      last_error = NULL,
      updated_at = datetime('now')
  `).bind(
    leadId,
    initialId ? 'signal_wait' : 'review_wait',
    initialNextRun,
    `+${REVIEW_DELAY_MINUTES} minutes`,
    initialId,
    `+${REVIEW_DELAY_MINUTES} minutes`,
  ).run();
  return true;
}

export async function processDueEmailAutomations(
  env: Env,
  options: { limit?: number; automationId?: number; force?: boolean; publicOrigin?: string } = {},
): Promise<{ checked: number; processed: number; sent: number; completed: number; failed: number }> {
  const limit = Math.min(Math.max(options.limit ?? 20, 1), 100);
  const clauses = [
    "status = 'active'",
    "(processing_at IS NULL OR processing_at < datetime('now', '-15 minutes'))",
  ];
  const params: unknown[] = [];
  if (options.automationId) {
    clauses.push('id = ?');
    params.push(options.automationId);
  } else if (!options.force) {
    clauses.push("next_run_at IS NOT NULL AND next_run_at <= datetime('now')");
  }
  const rows = await env.DB.prepare(`
    SELECT * FROM email_automations
     WHERE ${clauses.join(' AND ')}
     ORDER BY next_run_at ASC, id ASC
     LIMIT ?
  `).bind(...params, limit).all<AutomationRow>();

  const result = { checked: rows.results?.length ?? 0, processed: 0, sent: 0, completed: 0, failed: 0 };
  for (const automation of rows.results ?? []) {
    const claim = await env.DB.prepare(`
      UPDATE email_automations
         SET processing_at = datetime('now'), updated_at = datetime('now')
       WHERE id = ?
         AND status = 'active'
         AND (processing_at IS NULL OR processing_at < datetime('now', '-15 minutes'))
    `).bind(automation.id).run();
    if (!claim.meta.changes) continue;
    result.processed += 1;
    try {
      const outcome = await processAutomation(env, automation, options.publicOrigin);
      if (outcome === 'sent') result.sent += 1;
      if (outcome === 'completed') result.completed += 1;
    } catch (error) {
      result.failed += 1;
      const message = (error as Error).message;
      await env.DB.prepare(`
        UPDATE email_automations
           SET status = 'failed', processing_at = NULL, next_run_at = NULL,
               last_error = ?, updated_at = datetime('now')
         WHERE id = ?
      `).bind(message.slice(0, 1000), automation.id).run();
      log('error', 'email-automation', `Automation ${automation.id} failed`, error);
    }
  }
  return result;
}

async function processAutomation(
  env: Env,
  automation: AutomationRow,
  requestOrigin?: string,
): Promise<'sent' | 'completed' | 'advanced'> {
  const lead = await env.DB.prepare(
    'SELECT * FROM leads WHERE id = ? AND deleted_at IS NULL',
  ).bind(automation.lead_id).first<Lead>();
  if (!lead) throw new Error('Lead no longer exists');
  if (!lead.email || !lead.site_url) throw new Error('Lead is missing email or site URL');

  if (lead.pipeline_status === 'engaged' || lead.pipeline_sessions > 0) {
    await completeAutomation(env, automation.id, 'demo_clicked');
    return 'completed';
  }

  const terminalSend = await env.DB.prepare(`
    SELECT status, last_error FROM email_sends
     WHERE lead_id = ?
       AND id IN (?, ?, ?)
       AND status IN ('bounced', 'complained', 'suppressed', 'failed')
     ORDER BY id DESC LIMIT 1
  `).bind(
    lead.id,
    automation.initial_send_id ?? -1,
    automation.followup_send_id ?? -1,
    automation.final_send_id ?? -1,
  ).first<{ status: string; last_error: string | null }>();
  if (terminalSend) {
    throw new Error(terminalSend.last_error || `Email ${terminalSend.status}`);
  }

  const publicUrl = publicOutreachUrl(env, requestOrigin);
  if (!publicUrl) throw new Error('OUTREACH_PUBLIC_URL not configured');

  if (automation.current_step === 'review_wait') {
    const base = buildAutomationEmail(lead, 'stage_1', publicUrl);
    const content = applyPendingEdit(base, automation);
    const sent = await sendOutreachEmail(env, lead, content, publicUrl);
    await env.DB.prepare(`
      UPDATE email_automations
         SET current_step = 'signal_wait', initial_send_id = ?,
             next_run_at = datetime('now', ?), processing_at = NULL,
             pending_subject = NULL, pending_text = NULL,
             updated_at = datetime('now')
       WHERE id = ?
    `).bind(sent.sendId, `+${SIGNAL_WAIT_HOURS} hours`, automation.id).run();
    return 'sent';
  }

  if (automation.current_step === 'signal_wait') {
    const initial = await env.DB.prepare(`
      SELECT opened_at, clicked_at FROM email_sends WHERE id = ?
    `).bind(automation.initial_send_id).first<{ opened_at: string | null; clicked_at: string | null }>();
    if (initial?.clicked_at || lead.pipeline_sessions > 0) {
      await completeAutomation(env, automation.id, 'demo_clicked');
      return 'completed';
    }
    const branch = initial?.opened_at ? 'opened_no_click' : 'no_open';
    const key: EmailTemplateKey = branch === 'opened_no_click'
      ? 'stage_3_opened'
      : 'stage_2_no_open';
    const base = buildAutomationEmail(lead, key, publicUrl);
    const content = applyPendingEdit(base, automation);
    const sent = await sendOutreachEmail(env, lead, content, publicUrl);
    await env.DB.prepare(`
      UPDATE email_automations
         SET current_step = 'final_wait', branch = ?, followup_send_id = ?,
             next_run_at = datetime('now', ?), processing_at = NULL,
             pending_subject = NULL, pending_text = NULL,
             updated_at = datetime('now')
       WHERE id = ?
    `).bind(branch, sent.sendId, `+${FINAL_WAIT_DAYS} days`, automation.id).run();
    return 'sent';
  }

  if (automation.current_step === 'final_wait') {
    if (lead.pipeline_status === 'engaged' || lead.pipeline_sessions > 0) {
      await completeAutomation(env, automation.id, 'demo_clicked');
      return 'completed';
    }
    const base = buildAutomationEmail(lead, 'stage_5_final', publicUrl);
    const content = applyPendingEdit(base, automation);
    const sent = await sendOutreachEmail(env, lead, content, publicUrl);
    await env.DB.prepare(`
      UPDATE email_automations
         SET current_step = 'archive_wait', final_send_id = ?,
             next_run_at = datetime('now', ?), processing_at = NULL,
             pending_subject = NULL, pending_text = NULL,
             updated_at = datetime('now')
       WHERE id = ?
    `).bind(sent.sendId, `+${ARCHIVE_WAIT_DAYS} days`, automation.id).run();
    return 'sent';
  }

  if (automation.current_step === 'archive_wait') {
    if (lead.pipeline_status === 'engaged' || lead.pipeline_sessions > 0) {
      await completeAutomation(env, automation.id, 'demo_clicked');
      return 'completed';
    }
    await env.DB.batch([
      env.DB.prepare(`
        UPDATE email_automations
           SET status = 'paused', next_run_at = NULL,
               processing_at = NULL, updated_at = datetime('now')
         WHERE id = ?
      `).bind(automation.id),
      env.DB.prepare(`
        UPDATE leads
           SET outcome = 'Final Review', pipeline_last_action_at = datetime('now'),
               updated_at = datetime('now')
         WHERE id = ?
      `).bind(lead.id),
      env.DB.prepare(`
        INSERT INTO lead_activity (lead_id, action, from_status, to_status, meta)
        VALUES (?, 'email_final_review', ?, NULL, ?)
      `).bind(lead.id, lead.pipeline_status, JSON.stringify({
        source: 'email_automation',
        reason: 'sequence_complete_no_engagement',
      })),
    ]);
    return 'advanced';
  }

  await completeAutomation(env, automation.id, automation.branch);
  return 'completed';
}

async function completeAutomation(
  env: Env,
  automationId: number,
  branch: AutomationRow['branch'],
): Promise<void> {
  await env.DB.prepare(`
    UPDATE email_automations
       SET status = 'completed', current_step = 'complete', branch = ?,
           completed_at = datetime('now'), next_run_at = NULL,
           processing_at = NULL, updated_at = datetime('now')
     WHERE id = ?
  `).bind(branch, automationId).run();
}

function applyPendingEdit(base: EmailContent, automation: AutomationRow): EmailContent {
  return {
    ...base,
    subject: automation.pending_subject || base.subject,
    text: automation.pending_text || base.text,
  };
}

function renderEmailHtml(text: string, pixelUrl: string): string {
  const linked = text.split(/(https?:\/\/[^\s]+)/g).map((part) => {
    const escaped = escapeHtml(part);
    return /^https?:\/\//.test(part)
      ? `<a href="${escaped}" style="color:#2563eb;text-decoration:underline">${escaped}</a>`
      : escaped;
  }).join('').replace(/\n/g, '<br>');
  return `<!doctype html><html><body style="margin:0;background:#fff"><div style="max-width:620px;margin:0 auto;padding:24px;font-family:Arial,sans-serif;font-size:16px;line-height:1.6;color:#1f2937">${linked}</div><img src="${escapeHtml(pixelUrl)}" width="1" height="1" alt="" style="display:block;border:0;width:1px;height:1px"></body></html>`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

export function validateOutreachRecipient(email: string): string | null {
  const normalized = email.trim().toLowerCase();
  const domain = normalized.split('@')[1] ?? '';
  if (!normalized.includes('@') || !domain.includes('.')) {
    return 'Recipient email is not valid. Update the lead email before sending.';
  }
  if (['example.com', 'example.org', 'example.net', 'test.com'].includes(domain)) {
    return `Recipient ${email} uses a placeholder domain. Update the lead email before sending.`;
  }
  if (['gmal.com', 'gmial.com', 'gmai.com', 'gmail.co', 'hotmal.com', 'outlok.com'].includes(domain)) {
    return `Recipient ${email} looks mistyped. Confirm and correct the lead email before sending.`;
  }
  return null;
}
