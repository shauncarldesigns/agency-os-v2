import type { Lead } from '../types';

export const NOT_INTERESTED_REASONS = new Set([
  'price_budget',
  'bad_timing',
  'existing_provider',
  'no_value',
  'do_it_themselves',
  'partner_approval',
  'outreach_trust',
  'business_change',
  'different_service',
  'other',
]);

export interface NotInterestedCloseoutInput {
  reason?: string | null;
  receptionistInterested?: boolean;
  receptionistEmail?: string | null;
  now?: string;
  lastCalledAt?: string | null;
}

/**
 * Canonical website-opportunity closeout. Every Not Interested entry point
 * calls this so calls, text, email, and manual CRM edits cannot leave a lead
 * in the old "closed but not archived" limbo state.
 */
export async function closeLeadNotInterested(
  db: D1Database,
  leadId: number,
  input: NotInterestedCloseoutInput = {},
): Promise<Lead | null> {
  const existing = await db.prepare('SELECT * FROM leads WHERE id = ? AND deleted_at IS NULL')
    .bind(leadId).first<Lead>();
  if (!existing) return null;

  const now = input.now ?? new Date().toISOString();
  const receptionistInterested = input.receptionistInterested === true;
  const receptionistEmail = input.receptionistEmail?.trim() || null;
  const requestedReason = input.reason?.trim() || null;
  const reason = requestedReason && NOT_INTERESTED_REASONS.has(requestedReason) ? requestedReason : null;

  await db.batch([
    db.prepare(`
      UPDATE leads
         SET status = 'not_interested', outcome = 'Not Interested',
             pipeline_status = 'archived',
             not_interested_reason = COALESCE(?, not_interested_reason),
             demo_site_status = CASE
               WHEN demo_site_status = 'deleted' THEN 'deleted'
               WHEN COALESCE(NULLIF(TRIM(site_url_raw), ''), NULLIF(TRIM(site_url), ''), '') != '' THEN 'cleanup_needed'
               ELSE 'none'
             END,
             receptionist_interested = ?,
             receptionist_interested_at = CASE WHEN ? = 1 THEN ? ELSE receptionist_interested_at END,
             email = COALESCE(?, email),
             last_called_at = COALESCE(?, last_called_at),
             pipeline_last_action_at = ?, updated_at = ?
       WHERE id = ?
    `).bind(
      reason,
      receptionistInterested ? 1 : 0,
      receptionistInterested ? 1 : 0,
      now,
      receptionistEmail,
      input.lastCalledAt ?? null,
      now,
      now,
      leadId,
    ),
    db.prepare(`
      UPDATE email_automations
         SET status = 'stopped', stopped_at = COALESCE(stopped_at, datetime('now')), updated_at = datetime('now')
       WHERE lead_id = ? AND status IN ('active', 'paused')
    `).bind(leadId),
    db.prepare(`
      UPDATE callbacks SET status = 'cancelled'
       WHERE lead_id = ? AND status = 'pending'
    `).bind(leadId),
  ]);

  return db.prepare('SELECT * FROM leads WHERE id = ?').bind(leadId).first<Lead>();
}

export const UNABLE_TO_REACH_REASONS = new Set([
  'disconnected', 'wrong_number', 'no_contact', 'business_closed', 'call_screening',
]);

export function unableToReachReasonLabel(reason: string): string {
  const labels: Record<string, string> = {
    disconnected: 'Disconnected number', wrong_number: 'Wrong number',
    no_contact: 'No usable contact information', business_closed: 'Business appears closed',
    call_screening: 'Call screening blocked',
  };
  return labels[reason] ?? 'Unable to reach';
}

export async function closeLeadBadContact(db: D1Database, leadId: number, reason: string, now: string): Promise<Lead | null> {
  const label = unableToReachReasonLabel(reason);
  await db.batch([
    db.prepare(`
      UPDATE leads SET status = CASE WHEN status = 'cold' THEN 'contacted' ELSE status END,
        outcome = ?, pipeline_status = 'archived', phone_valid = 0,
        demo_site_status = CASE
          WHEN demo_site_status = 'deleted' THEN 'deleted'
          WHEN COALESCE(NULLIF(TRIM(site_url_raw), ''), NULLIF(TRIM(site_url), ''), '') != '' THEN 'cleanup_needed'
          ELSE 'none'
        END,
        last_called_at = ?, pipeline_last_action_at = ?, updated_at = ? WHERE id = ?
    `).bind(label, now, now, now, leadId),
    db.prepare(`UPDATE email_automations SET status='stopped', stopped_at=COALESCE(stopped_at,datetime('now')), updated_at=datetime('now') WHERE lead_id=? AND status IN ('active','paused')`).bind(leadId),
    db.prepare(`UPDATE callbacks SET status='cancelled' WHERE lead_id=? AND status='pending'`).bind(leadId),
  ]);
  return db.prepare('SELECT * FROM leads WHERE id=?').bind(leadId).first<Lead>();
}
