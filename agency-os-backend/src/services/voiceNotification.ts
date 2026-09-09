import type { Env } from '../types';
import { sendEmail } from './email';
import { retellMode } from './retellClient';

interface NotificationContext {
  id: number;
  source_call_id: number;
  caller_name: string | null;
  caller_phone: string | null;
  caller_email: string | null;
  service_requested: string | null;
  urgency: string;
  preferred_timing: string | null;
  intake_notes: string | null;
  business_name: string;
  notification_email: string;
}

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char);

export async function notifyVoiceLead(env: Env, voiceLeadId: number, force = false): Promise<void> {
  const lead = await env.DB.prepare(`
    SELECT v.*, p.business_name, p.notification_email
      FROM voice_leads v JOIN voice_business_profiles p ON p.id=v.voice_business_profile_id
     WHERE v.id=?
  `).bind(voiceLeadId).first<NotificationContext>();
  if (!lead) return;
  const type = lead.urgency === 'emergency' ? 'emergency' : 'new_lead';
  if (force) {
    await env.DB.prepare(`UPDATE voice_notifications SET delivery_status='pending', provider_message_id=NULL, error_message=NULL, sent_at=NULL WHERE voice_lead_id=? AND notification_type=?`).bind(lead.id, type).run();
  } else {
    const inserted = await env.DB.prepare(`
      INSERT OR IGNORE INTO voice_notifications (voice_lead_id, voice_call_id, notification_type, recipient)
      VALUES (?, ?, ?, ?)
    `).bind(lead.id, lead.source_call_id, type, lead.notification_email).run();
    if (!(inserted.meta.changes ?? 0)) return;
  }
  if (retellMode(env) === 'mock') {
    await env.DB.prepare(`UPDATE voice_notifications SET delivery_status='simulated', sent_at=datetime('now') WHERE voice_lead_id=? AND notification_type=?`).bind(lead.id, type).run();
    return;
  }
  const rows = [
    ['Caller', lead.caller_name || 'Not captured'], ['Phone', lead.caller_phone || 'Not captured'],
    ['Email', lead.caller_email || 'Not captured'], ['Request', lead.service_requested || 'Not captured'],
    ['Urgency', lead.urgency], ['Preferred timing', lead.preferred_timing || 'Not captured'],
  ];
  const text = [`${type === 'emergency' ? 'Urgent receptionist call' : 'New receptionist lead'} for ${lead.business_name}`, '', ...rows.map(([label, value]) => `${label}: ${value}`), '', `Notes: ${lead.intake_notes || 'None'}`].join('\n');
  try {
    const result = await sendEmail(env.RESEND_API_KEY, {
      to: lead.notification_email,
      from: env.OUTREACH_EMAIL_FROM || 'Shaun Carl Designs <info@shauncarldesigns.com>',
      replyTo: env.OUTREACH_EMAIL_REPLY_TO,
      subject: `${type === 'emergency' ? 'URGENT: ' : ''}Receptionist lead — ${lead.business_name}`,
      text,
      html: `<h2>${escapeHtml(type === 'emergency' ? 'Urgent receptionist call' : 'New receptionist lead')}</h2><p><strong>${escapeHtml(lead.business_name)}</strong></p><table>${rows.map(([label, value]) => `<tr><td><strong>${escapeHtml(label)}</strong></td><td>${escapeHtml(value)}</td></tr>`).join('')}</table><p><strong>Notes:</strong> ${escapeHtml(lead.intake_notes || 'None')}</p>`,
      tags: [{ name: 'voice_lead_id', value: String(lead.id) }, { name: 'notification_type', value: type }],
    });
    await env.DB.prepare(`UPDATE voice_notifications SET delivery_status='sent', provider_message_id=?, sent_at=datetime('now') WHERE voice_lead_id=? AND notification_type=?`).bind(result.id, lead.id, type).run();
  } catch (error) {
    await env.DB.prepare(`UPDATE voice_notifications SET delivery_status='failed', error_message=? WHERE voice_lead_id=? AND notification_type=?`).bind((error as Error).message.slice(0, 500), lead.id, type).run();
  }
}

interface FailedTransferContext {
  id: number;
  from_number: string | null;
  summary: string | null;
  disconnection_reason: string | null;
  business_name: string;
  notification_email: string;
}

export async function notifyFailedTransfer(env: Env, voiceCallId: number, retryNotificationId?: number): Promise<void> {
  const call = await env.DB.prepare(`
    SELECT c.id, c.from_number, c.summary, c.disconnection_reason, p.business_name, p.notification_email
      FROM voice_calls c JOIN voice_business_profiles p ON p.id=c.voice_business_profile_id
     WHERE c.id=?
  `).bind(voiceCallId).first<FailedTransferContext>();
  if (!call) return;
  let notificationId = retryNotificationId;
  if (notificationId) {
    await env.DB.prepare(`UPDATE voice_notifications SET delivery_status='pending', provider_message_id=NULL, error_message=NULL, sent_at=NULL WHERE id=? AND voice_call_id=? AND notification_type='failed_transfer'`).bind(notificationId, call.id).run();
  } else {
    const inserted = await env.DB.prepare(`INSERT INTO voice_notifications (voice_call_id, notification_type, recipient) VALUES (?, 'failed_transfer', ?)`).bind(call.id, call.notification_email).run();
    notificationId = Number(inserted.meta.last_row_id);
  }
  if (!notificationId) return;
  if (retellMode(env) === 'mock') {
    await env.DB.prepare(`UPDATE voice_notifications SET delivery_status='simulated', sent_at=datetime('now') WHERE id=?`).bind(notificationId).run();
    return;
  }
  const reason = call.disconnection_reason || 'Retell reported that the transfer did not complete.';
  const text = [`Failed receptionist transfer — ${call.business_name}`, '', `Caller: ${call.from_number || 'Not captured'}`, `Reason: ${reason}`, `Call summary: ${call.summary || 'Not available'}`, '', 'Review the call in Agency OS and contact the caller if appropriate.'].join('\n');
  try {
    const result = await sendEmail(env.RESEND_API_KEY, {
      to: call.notification_email,
      from: env.OUTREACH_EMAIL_FROM || 'Shaun Carl Designs <info@shauncarldesigns.com>',
      replyTo: env.OUTREACH_EMAIL_REPLY_TO,
      subject: `Failed receptionist transfer — ${call.business_name}`,
      text,
      html: `<h2>Failed receptionist transfer</h2><p><strong>${escapeHtml(call.business_name)}</strong></p><p><strong>Caller:</strong> ${escapeHtml(call.from_number || 'Not captured')}</p><p><strong>Reason:</strong> ${escapeHtml(reason)}</p><p><strong>Call summary:</strong> ${escapeHtml(call.summary || 'Not available')}</p><p>Review the call in Agency OS and contact the caller if appropriate.</p>`,
      tags: [{ name: 'voice_call_id', value: String(call.id) }, { name: 'notification_type', value: 'failed_transfer' }],
    });
    await env.DB.prepare(`UPDATE voice_notifications SET delivery_status='sent', provider_message_id=?, sent_at=datetime('now') WHERE id=?`).bind(result.id, notificationId).run();
  } catch (error) {
    await env.DB.prepare(`UPDATE voice_notifications SET delivery_status='failed', error_message=? WHERE id=?`).bind((error as Error).message.slice(0, 500), notificationId).run();
  }
}
