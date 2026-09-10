import { Hono } from 'hono';
import type { Env } from '../types';
import { badRequest, notFound } from '../utils/errors';
import { discoverRetellResources, retellHealth, retellMode, validateRetellApiKey, validateRetellConnection } from '../services/retellClient';
import { normalizePhone, resolveVoiceDemo, type VoiceProfileRow } from '../services/voiceDemo';
import { syncVoiceLeadFromCall } from '../services/voiceLead';
import { notifyFailedTransfer, notifyVoiceLead } from '../services/voiceNotification';
import { buildRetellSetupPackage } from '../services/retellSetupPackage';
import { purgeExpiredVoiceContent, voiceRetentionStatus } from '../services/voiceRetention';
import { processRetellEventPayload } from './retellWebhooks';
import { sendEmail } from '../services/email';
import {
  simulateReceptionistTurn,
  simulateReceptionistTurnAI,
  summarizeSimulation,
  VOICE_AGENT_RULES,
  VOICE_AGENT_PROMPT_VERSION,
  type SimulatorTurn,
  type VoiceClassification,
  type VoiceIntake,
} from '../services/voiceAgent';

export const voiceRouter = new Hono<{ Bindings: Env }>();

function leadTextItems(value: unknown): string[] {
  if (typeof value !== 'string' || !value.trim()) return [];
  const raw = value.trim();
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) return parsed.filter((item): item is string => typeof item === 'string' && Boolean(item.trim())).map((item) => item.trim());
  } catch { /* Legacy and manually entered lead fields may be plain text. */ }
  return raw.split(/\r?\n|\s*;\s*/).map((item) => item.trim()).filter(Boolean);
}

function uniqueLeadText(items: string[]): string[] {
  return [...new Map(items.map((item) => [item.toLocaleLowerCase(), item])).values()];
}

async function ensureProfileFromLead(env: Env, leadId: number) {
  const lead = await env.DB.prepare(`SELECT * FROM leads WHERE id=? AND deleted_at IS NULL`).bind(leadId).first<Record<string, unknown>>();
  if (!lead) return null;
  const existing = await env.DB.prepare(`SELECT * FROM voice_business_profiles WHERE lead_id=? ORDER BY id DESC LIMIT 1`).bind(leadId).first<Record<string, unknown>>();
  if (existing) return { lead, profile: existing };
  const businessName = String(lead.company ?? '').trim();
  if (!businessName) return { lead, profile: null };
  const serviceParts = uniqueLeadText([...leadTextItems(lead.extracted_services), ...leadTextItems(lead.industry)]);
  const areaParts = uniqueLeadText([...leadTextItems(lead.extracted_service_areas), [lead.city, lead.state].filter(Boolean).join(', ')]).filter(Boolean);
  const hours = leadTextItems(lead.gbp_hours).join('\n');
  const result = await env.DB.prepare(`
    INSERT INTO voice_business_profiles (
      profile_kind, lead_id, business_name, business_phone, timezone, greeting,
      services_text, service_area_text, hours_text, default_mode, transfer_enabled,
      emergency_transfer_enabled, notification_email, recording_retention_days,
      status, public_phone_number, retell_agent_id
    ) VALUES ('prospect', ?, ?, ?, 'America/Chicago', ?, ?, ?, ?, 'intake_only', 0, 0, ?, 30, 'testing', ?, ?)
  `).bind(
    leadId, businessName, lead.phone ?? null, `Thanks for calling ${businessName}. How can I help you today?`,
    serviceParts.join('\n'), areaParts.join('\n'), hours,
    'info@shauncarldesigns.com', env.RETELL_SHARED_PHONE_NUMBER ?? null, env.RETELL_DEFAULT_AGENT_ID ?? null,
  ).run();
  const profile = await env.DB.prepare(`SELECT * FROM voice_business_profiles WHERE id=?`).bind(result.meta.last_row_id).first<Record<string, unknown>>();
  return { lead, profile };
}

voiceRouter.get('/overview', async (c) => {
  const [profiles, calls, totals, activeDemo, voiceLeads, qaRuns, notifications, webhookHealth, webhookFailures, invitations] = await c.env.DB.batch([
    c.env.DB.prepare(`SELECT * FROM voice_business_profiles ORDER BY updated_at DESC`),
    c.env.DB.prepare(`SELECT c.*, p.business_name FROM voice_calls c LEFT JOIN voice_business_profiles p ON p.id=c.voice_business_profile_id ORDER BY c.created_at DESC LIMIT 25`),
    c.env.DB.prepare(`SELECT COUNT(*) calls_answered, COALESCE(SUM(CASE WHEN classification='new_customer' THEN 1 ELSE 0 END),0) opportunities, COALESCE(SUM(CASE WHEN classification IN ('cold_sales','spam') THEN 1 ELSE 0 END),0) screened FROM voice_calls`),
    c.env.DB.prepare(`SELECT * FROM voice_demo_sessions WHERE status='active' AND expires_at > datetime('now') ORDER BY activated_at DESC LIMIT 1`),
    c.env.DB.prepare(`SELECT v.*, p.business_name, c.classification, c.summary AS call_summary FROM voice_leads v JOIN voice_business_profiles p ON p.id=v.voice_business_profile_id JOIN voice_calls c ON c.id=v.source_call_id ORDER BY CASE v.status WHEN 'new' THEN 0 WHEN 'contacted' THEN 1 ELSE 2 END, v.created_at DESC LIMIT 100`),
    c.env.DB.prepare(`SELECT q.*, p.business_name FROM voice_qa_runs q JOIN voice_business_profiles p ON p.id=q.voice_business_profile_id ORDER BY q.created_at DESC, q.id DESC LIMIT 20`),
    c.env.DB.prepare(`SELECT n.*, COALESCE(lp.business_name, cp.business_name) AS business_name FROM voice_notifications n LEFT JOIN voice_leads v ON v.id=n.voice_lead_id LEFT JOIN voice_business_profiles lp ON lp.id=v.voice_business_profile_id LEFT JOIN voice_calls c ON c.id=n.voice_call_id LEFT JOIN voice_business_profiles cp ON cp.id=c.voice_business_profile_id ORDER BY n.created_at DESC, n.id DESC LIMIT 20`),
    c.env.DB.prepare(`SELECT MAX(CASE WHEN processing_status='processed' THEN processed_at END) AS last_success_at, COALESCE(SUM(CASE WHEN processing_status='failed' THEN 1 ELSE 0 END),0) AS failed_count, COUNT(*) AS total_events FROM voice_webhook_events`),
    c.env.DB.prepare(`SELECT id, event_type, provider_call_id, processing_attempts, received_at, error_message FROM voice_webhook_events WHERE processing_status='failed' ORDER BY received_at DESC LIMIT 10`),
    c.env.DB.prepare(`SELECT i.*, p.business_name FROM voice_demo_invitations i JOIN voice_business_profiles p ON p.id=i.voice_business_profile_id ORDER BY i.created_at DESC LIMIT 100`),
  ]);
  const retention = await voiceRetentionStatus(c.env.DB);
  return c.json({
    health: {
      ...retellHealth(c.env),
      inboundWebhookUrl: 'https://agency-os-v2-api.lively-morning-d9de.workers.dev/webhooks/retell/inbound',
      eventsWebhookUrl: 'https://agency-os-v2-api.lively-morning-d9de.workers.dev/webhooks/retell/events',
      previewModel: c.env.VOICE_PREVIEW_MODEL || 'gpt-4.1-mini',
    },
    profiles: profiles.results,
    calls: calls.results,
    totals: totals.results[0] ?? { calls_answered: 0, opportunities: 0, screened: 0 },
    activeDemo: activeDemo.results[0] ?? null,
    voiceLeads: voiceLeads.results,
    qaRuns: qaRuns.results,
    notifications: notifications.results,
    webhookHealth: webhookHealth.results[0] ?? { last_success_at: null, failed_count: 0, total_events: 0 },
    webhookFailures: webhookFailures.results,
    invitations: invitations.results,
    retention,
  });
});

voiceRouter.post('/retention/run', async (c) => {
  const purged = await purgeExpiredVoiceContent(c.env.DB);
  return c.json({ purged, retention: await voiceRetentionStatus(c.env.DB) });
});

voiceRouter.put('/leads/:id', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id <= 0) return c.json(badRequest('Invalid voice lead ID'), 400);
  const body = await c.req.json().catch(() => ({})) as { status?: string; estimatedValue?: number | null; confirmedRevenue?: number | null; intakeNotes?: string };
  const statuses = ['new','contacted','appointment','booked','won','lost','spam'];
  if (body.status && !statuses.includes(body.status)) return c.json(badRequest('Invalid voice lead status'), 400);
  const existing = await c.env.DB.prepare(`SELECT * FROM voice_leads WHERE id=?`).bind(id).first();
  if (!existing) return c.json(notFound('Voice lead'), 404);
  if (body.estimatedValue !== undefined && body.estimatedValue !== null && (!Number.isFinite(body.estimatedValue) || body.estimatedValue < 0)) return c.json(badRequest('Estimated value must be zero or greater'), 400);
  if (body.confirmedRevenue !== undefined && body.confirmedRevenue !== null && (!Number.isFinite(body.confirmedRevenue) || body.confirmedRevenue < 0)) return c.json(badRequest('Confirmed revenue must be zero or greater'), 400);
  await c.env.DB.prepare(`UPDATE voice_leads SET status=COALESCE(?,status), estimated_value=?, confirmed_revenue=?, intake_notes=COALESCE(?,intake_notes), updated_at=datetime('now') WHERE id=?`).bind(
    body.status ?? null,
    body.estimatedValue === undefined ? (existing as Record<string, unknown>).estimated_value : body.estimatedValue,
    body.confirmedRevenue === undefined ? (existing as Record<string, unknown>).confirmed_revenue : body.confirmedRevenue,
    typeof body.intakeNotes === 'string' ? body.intakeNotes.trim().slice(0, 2_000) : null,
    id,
  ).run();
  const lead = await c.env.DB.prepare(`SELECT * FROM voice_leads WHERE id=?`).bind(id).first();
  return c.json({ lead });
});

voiceRouter.post('/connection/test', async (c) => {
  try {
    const connection = await validateRetellConnection(c.env);
    return c.json({ connection, checkedAt: new Date().toISOString() });
  } catch (error) {
    const message = (error as Error).message;
    return c.json({ error: message, code: message.includes('not configured') ? 'RETELL_NOT_CONFIGURED' : 'RETELL_CONNECTION_FAILED' }, message.includes('not configured') ? 409 : 502);
  }
});

voiceRouter.post('/connection/auth-test', async (c) => {
  try { return c.json({ authentication: await validateRetellApiKey(c.env), checkedAt: new Date().toISOString() }); }
  catch (error) { return c.json({ error: (error as Error).message, code: 'RETELL_AUTHENTICATION_FAILED' }, 502); }
});

voiceRouter.get('/connection/resources', async (c) => {
  try { return c.json({ resources: await discoverRetellResources(c.env), checkedAt: new Date().toISOString() }); }
  catch (error) { return c.json({ error: (error as Error).message, code: 'RETELL_DISCOVERY_FAILED' }, 502); }
});

voiceRouter.post('/demo-sessions/reset', async (c) => {
  const result = await c.env.DB.prepare(`UPDATE voice_demo_sessions SET status='canceled' WHERE status='active'`).run();
  return c.json({ canceled: result.meta.changes ?? 0 });
});

voiceRouter.post('/fallback/test', async (c) => {
  const resolved = await resolveVoiceDemo(c.env.DB, '+10000000000', c.env.RETELL_SHARED_PHONE_NUMBER || '+19999999999');
  if (!resolved || resolved.profile.profile_kind !== 'test') return c.json({ ok: false, error: 'No eligible standalone fallback profile is configured' }, 409);
  return c.json({ ok: true, profileId: resolved.profile.id, businessName: resolved.profile.business_name });
});

voiceRouter.post('/readiness/test', async (c) => {
  const [profiles, fallback, routingRows, orphanSessions, schemaCounts] = await Promise.all([
    c.env.DB.prepare(`SELECT COUNT(*) AS count FROM voice_business_profiles`).first<{ count: number }>(),
    resolveVoiceDemo(c.env.DB, '+10000000000', c.env.RETELL_SHARED_PHONE_NUMBER || '+19999999999'),
    c.env.DB.prepare(`SELECT public_phone_number, private_transfer_destination FROM voice_business_profiles WHERE public_phone_number IS NOT NULL AND private_transfer_destination IS NOT NULL`).all<{ public_phone_number: string; private_transfer_destination: string }>(),
    c.env.DB.prepare(`SELECT COUNT(*) AS count FROM voice_demo_sessions s LEFT JOIN voice_business_profiles p ON p.id=s.voice_business_profile_id WHERE s.status='active' AND p.id IS NULL`).first<{ count: number }>(),
    c.env.DB.batch([
      c.env.DB.prepare(`SELECT COUNT(*) AS count FROM voice_calls`),
      c.env.DB.prepare(`SELECT COUNT(*) AS count FROM voice_leads`),
      c.env.DB.prepare(`SELECT COUNT(*) AS count FROM voice_notifications`),
      c.env.DB.prepare(`SELECT COUNT(*) AS count FROM voice_qa_runs`),
    ]),
  ]);
  const routingConflicts = routingRows.results.filter((row) => normalizePhone(row.public_phone_number) === normalizePhone(row.private_transfer_destination)).length;
  const countAt = (index: number) => Number((schemaCounts[index].results[0] as { count?: number } | undefined)?.count ?? 0);
  const checks = [
    { key: 'profiles', label: 'At least one voice profile exists', status: Number(profiles?.count ?? 0) > 0 ? 'pass' : 'fail', detail: `${Number(profiles?.count ?? 0)} profiles` },
    { key: 'fallback', label: 'Internal fallback resolves safely', status: fallback?.profile.profile_kind === 'test' ? 'pass' : 'fail', detail: fallback?.profile.business_name ?? 'No fallback profile' },
    { key: 'routing', label: 'Public and private numbers are distinct', status: routingConflicts === 0 ? 'pass' : 'fail', detail: `${routingConflicts} conflicts` },
    { key: 'sessions', label: 'Active demo sessions reference valid profiles', status: Number(orphanSessions?.count ?? 0) === 0 ? 'pass' : 'fail', detail: `${Number(orphanSessions?.count ?? 0)} orphaned sessions` },
    { key: 'calls', label: 'Call storage is accessible', status: 'pass', detail: `${countAt(0)} calls` },
    { key: 'leads', label: 'Voice Lead storage is accessible', status: 'pass', detail: `${countAt(1)} leads` },
    { key: 'alerts', label: 'Notification storage is accessible', status: 'pass', detail: `${countAt(2)} alerts` },
    { key: 'qa', label: 'QA history storage is accessible', status: 'pass', detail: `${countAt(3)} runs` },
  ];
  return c.json({ ready: checks.every((check) => check.status !== 'fail'), checkedAt: new Date().toISOString(), checks });
});

voiceRouter.get('/qa-runs/:id', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id <= 0) return c.json(badRequest('Invalid QA run ID'), 400);
  const run = await c.env.DB.prepare(`SELECT q.*, p.business_name FROM voice_qa_runs q JOIN voice_business_profiles p ON p.id=q.voice_business_profile_id WHERE q.id=?`).bind(id).first();
  if (!run) return c.json(notFound('QA run'), 404);
  const cases = await c.env.DB.prepare(`SELECT * FROM voice_qa_cases WHERE qa_run_id=? ORDER BY id`).bind(id).all();
  return c.json({ run, cases: cases.results });
});

voiceRouter.post('/webhook-events/:id/retry', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id <= 0) return c.json(badRequest('Invalid webhook event ID'), 400);
  const event = await c.env.DB.prepare(`SELECT * FROM voice_webhook_events WHERE id=?`).bind(id).first<{ id: number; event_type: string; deduplication_key: string; payload_json: string; processing_status: string; processing_attempts: number }>();
  if (!event) return c.json(notFound('Webhook event'), 404);
  if (event.processing_status !== 'failed') return c.json(badRequest('Only failed webhook events can be retried'), 400);
  if (event.processing_attempts >= 5) return c.json(badRequest('Retry limit reached; inspect the payload and underlying error'), 409);
  let payload: Record<string, unknown>;
  try { payload = JSON.parse(event.payload_json) as Record<string, unknown>; }
  catch { return c.json(badRequest('Stored webhook payload is invalid JSON'), 409); }
  try {
    await processRetellEventPayload(c.env, payload, event.event_type, (promise) => c.executionCtx.waitUntil(promise));
    await c.env.DB.prepare(`UPDATE voice_webhook_events SET processing_status='processed', processing_attempts=processing_attempts+1, processed_at=datetime('now'), error_message=NULL WHERE id=?`).bind(id).run();
  } catch (error) {
    await c.env.DB.prepare(`UPDATE voice_webhook_events SET processing_attempts=processing_attempts+1, error_message=? WHERE id=?`).bind((error as Error).message.slice(0, 500), id).run();
    throw error;
  }
  const updated = await c.env.DB.prepare(`SELECT id, event_type, provider_call_id, processing_attempts, processing_status, processed_at, error_message FROM voice_webhook_events WHERE id=?`).bind(id).first();
  return c.json({ event: updated });
});

voiceRouter.get('/profiles/:id/retell-package', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id <= 0) return c.json(badRequest('Invalid profile ID'), 400);
  const profile = await c.env.DB.prepare(`SELECT * FROM voice_business_profiles WHERE id=?`).bind(id).first();
  if (!profile) return c.json(notFound('Voice profile'), 404);
  return c.json({ setupPackage: buildRetellSetupPackage(profile as unknown as VoiceProfileRow) });
});

voiceRouter.post('/notifications/:id/retry', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id <= 0) return c.json(badRequest('Invalid notification ID'), 400);
  const notification = await c.env.DB.prepare(`SELECT * FROM voice_notifications WHERE id=?`).bind(id).first<{ voice_lead_id: number | null; voice_call_id: number | null; notification_type: string; delivery_status: string }>();
  if (!notification) return c.json(notFound('Notification'), 404);
  if (!['failed','simulated'].includes(notification.delivery_status)) return c.json(badRequest('Only failed or simulated notifications can be retried'), 400);
  if (notification.notification_type === 'failed_transfer' && notification.voice_call_id) await notifyFailedTransfer(c.env, notification.voice_call_id, id);
  else if (notification.voice_lead_id) await notifyVoiceLead(c.env, notification.voice_lead_id, true);
  else return c.json(badRequest('Notification has no associated call or lead'), 400);
  const updated = await c.env.DB.prepare(`SELECT * FROM voice_notifications WHERE id=?`).bind(id).first();
  return c.json({ notification: updated });
});

voiceRouter.post('/test-profile', async (c) => {
  const existing = await c.env.DB.prepare(`SELECT * FROM voice_business_profiles WHERE profile_kind='test' ORDER BY id LIMIT 1`).first();
  if (existing) return c.json({ profile: existing });
  const result = await c.env.DB.prepare(`
    INSERT INTO voice_business_profiles (
      profile_kind, business_name, business_phone, timezone, greeting, services_text,
      service_area_text, hours_text, default_mode, transfer_enabled, emergency_transfer_enabled,
      notification_email, recording_retention_days, status, public_phone_number, retell_agent_id
    ) VALUES ('test', 'Shaun Carl Designs Receptionist Demo', NULL, 'America/Chicago',
      'Thanks for calling Shaun Carl Designs. How can I help you today?',
      'Website design and digital services for local service businesses.',
      'Wisconsin and remote clients.', 'By appointment.', 'intake_only', 0, 0,
      'info@shauncarldesigns.com', 30, 'testing', ?, ?)
  `).bind(c.env.RETELL_SHARED_PHONE_NUMBER ?? null, c.env.RETELL_DEFAULT_AGENT_ID ?? null).run();
  const profile = await c.env.DB.prepare(`SELECT * FROM voice_business_profiles WHERE id=?`).bind(result.meta.last_row_id).first();
  return c.json({ profile }, 201);
});

voiceRouter.post('/profiles/from-lead/:leadId', async (c) => {
  const leadId = Number(c.req.param('leadId'));
  if (!Number.isInteger(leadId) || leadId <= 0) return c.json(badRequest('Invalid lead ID'), 400);
  const result = await ensureProfileFromLead(c.env, leadId);
  if (!result) return c.json(notFound('Lead'), 404);
  if (!result.profile) return c.json(badRequest('Lead requires a company name'), 400);
  return c.json({ profile: result.profile }, 201);
});

voiceRouter.post('/live-demo/from-lead/:leadId', async (c) => {
  const leadId = Number(c.req.param('leadId'));
  if (!Number.isInteger(leadId) || leadId <= 0) return c.json(badRequest('Invalid lead ID'), 400);
  const body = await c.req.json().catch(() => ({})) as { email?: string; callerPhone?: string; durationMinutes?: number };
  const email = String(body.email ?? '').trim().toLowerCase();
  const callerPhone = normalizePhone(body.callerPhone);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return c.json(badRequest('Enter a valid prospect email or leave it blank'), 400);
  if (!callerPhone) return c.json(badRequest('The phone that will place the demo call is required'), 400);
  const prepared = await ensureProfileFromLead(c.env, leadId);
  if (!prepared) return c.json(notFound('Lead'), 404);
  if (!prepared.profile) return c.json(badRequest('Lead requires a company name'), 400);
  const profileId = Number(prepared.profile.id);
  const sharedDemoNumber = normalizePhone(c.env.RETELL_SHARED_PHONE_NUMBER ?? String(prepared.profile.public_phone_number ?? ''));
  if (!sharedDemoNumber) return c.json(badRequest('The shared Retell demo number is not configured'), 400);
  if (callerPhone === sharedDemoNumber) return c.json(badRequest('Enter the phone number placing the demo call, not the shared demo number'), 400);
  const duration = Math.min(60, Math.max(5, Number(body.durationMinutes ?? 15)));
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE leads SET email=COALESCE(?, email), receptionist_interested=1, receptionist_interested_at=COALESCE(receptionist_interested_at, datetime('now')), outcome='Receptionist live demo prepared', updated_at=datetime('now') WHERE id=?`).bind(email || null, leadId),
    c.env.DB.prepare(`UPDATE voice_demo_sessions SET status='expired' WHERE caller_phone_match=? AND status='active'`).bind(callerPhone),
  ]);
  const inserted = await c.env.DB.prepare(`
    INSERT INTO voice_demo_sessions (voice_business_profile_id, prospect_id, demo_phone_number, caller_phone_match, profile_snapshot_json, expires_at)
    VALUES (?, ?, ?, ?, ?, datetime('now', ?))
  `).bind(profileId, leadId, sharedDemoNumber, callerPhone, JSON.stringify(prepared.profile), `+${duration} minutes`).run();
  const session = await c.env.DB.prepare(`SELECT * FROM voice_demo_sessions WHERE id=?`).bind(inserted.meta.last_row_id).first();
  return c.json({ profile: prepared.profile, session, demoPhoneNumber: sharedDemoNumber }, 201);
});

voiceRouter.put('/profiles/:id', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id <= 0) return c.json(badRequest('Invalid profile ID'), 400);
  const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
  const allowed = ['business_name','business_phone','timezone','greeting','services_text','service_area_text','hours_text','default_mode','transfer_enabled','emergency_transfer_enabled','private_transfer_destination','public_phone_number','retell_agent_id','retell_agent_version','voice_id','notification_email','recording_retention_days','status'] as const;
  const updates: Array<{ field: string; value: unknown }> = allowed.filter((field) => field in body).map((field) => ({ field, value: body[field] ?? null }));
  if (body.configuration && typeof body.configuration === 'object' && !Array.isArray(body.configuration)) {
    updates.push({ field: 'configuration_json', value: JSON.stringify(body.configuration).slice(0, 20_000) });
  }
  if (!updates.length) return c.json(badRequest('No valid fields to update'), 400);
  const current = await c.env.DB.prepare(`SELECT * FROM voice_business_profiles WHERE id=?`).bind(id).first<Record<string, unknown>>();
  if (!current) return c.json(notFound('Voice profile'), 404);
  const publicNumber = normalizePhone(String(body.public_phone_number ?? current.public_phone_number ?? ''));
  const transferNumber = normalizePhone(String(body.private_transfer_destination ?? current.private_transfer_destination ?? ''));
  if (publicNumber && transferNumber && publicNumber === transferNumber) return c.json(badRequest('Public and transfer numbers must be different'), 400);
  await c.env.DB.prepare(`UPDATE voice_business_profiles SET ${updates.map(({ field }) => `${field}=?`).join(', ')}, updated_at=datetime('now') WHERE id=?`).bind(...updates.map(({ value }) => value), id).run();
  const profile = await c.env.DB.prepare(`SELECT * FROM voice_business_profiles WHERE id=?`).bind(id).first();
  return c.json({ profile });
});

voiceRouter.post('/demo-sessions', async (c) => {
  const body = await c.req.json().catch(() => ({})) as { profileId?: number; callerPhone?: string; durationMinutes?: number };
  const profileId = Number(body.profileId);
  const callerPhone = normalizePhone(body.callerPhone);
  if (!Number.isInteger(profileId) || profileId <= 0 || !callerPhone) return c.json(badRequest('profileId and callerPhone are required'), 400);
  const profile = await c.env.DB.prepare(`SELECT * FROM voice_business_profiles WHERE id=?`).bind(profileId).first<Record<string, unknown>>();
  if (!profile) return c.json(notFound('Voice profile'), 404);
  const sharedDemoNumber = normalizePhone(c.env.RETELL_SHARED_PHONE_NUMBER ?? String(profile.public_phone_number ?? ''));
  if (sharedDemoNumber && callerPhone === sharedDemoNumber) return c.json(badRequest('Enter the phone number you will call from, not the shared Retell demo number'), 400);
  const duration = Math.min(120, Math.max(5, Number(body.durationMinutes ?? 30)));
  await c.env.DB.prepare(`UPDATE voice_demo_sessions SET status='expired' WHERE caller_phone_match=? AND status='active'`).bind(callerPhone).run();
  const result = await c.env.DB.prepare(`
    INSERT INTO voice_demo_sessions (voice_business_profile_id, prospect_id, demo_phone_number, caller_phone_match, profile_snapshot_json, expires_at)
    VALUES (?, ?, ?, ?, ?, datetime('now', ?))
  `).bind(profileId, profile.lead_id ?? null, profile.public_phone_number ?? c.env.RETELL_SHARED_PHONE_NUMBER ?? null, callerPhone, JSON.stringify(profile), `+${duration} minutes`).run();
  const session = await c.env.DB.prepare(`SELECT * FROM voice_demo_sessions WHERE id=?`).bind(result.meta.last_row_id).first();
  return c.json({ session }, 201);
});

voiceRouter.post('/profiles/:id/invitations', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id <= 0) return c.json(badRequest('Invalid profile ID'), 400);
  const body = await c.req.json().catch(() => ({})) as { recipientEmail?: string; expiresInDays?: number };
  const recipientEmail = String(body.recipientEmail ?? '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipientEmail)) return c.json(badRequest('A valid recipient email is required'), 400);
  const profile = await c.env.DB.prepare(`SELECT * FROM voice_business_profiles WHERE id=?`).bind(id).first<Record<string, unknown>>();
  if (!profile) return c.json(notFound('Voice profile'), 404);
  const demoNumber = normalizePhone(c.env.RETELL_SHARED_PHONE_NUMBER ?? String(profile.public_phone_number ?? ''));
  if (!demoNumber) return c.json(badRequest('The shared Retell demo number is not configured'), 400);
  const expiresInDays = Math.min(30, Math.max(1, Math.round(Number(body.expiresInDays ?? 7))));
  let accessCode = '';
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const bytes = crypto.getRandomValues(new Uint8Array(4));
    accessCode = String((bytes[0] * 0x1000000 + bytes[1] * 0x10000 + bytes[2] * 0x100 + bytes[3]) % 900000 + 100000);
    const collision = await c.env.DB.prepare(`SELECT id FROM voice_demo_invitations WHERE access_code=?`).bind(accessCode).first();
    if (!collision) break;
    accessCode = '';
  }
  if (!accessCode) return c.text('Could not allocate a demo access code', 503);
  const inserted = await c.env.DB.prepare(`
    INSERT INTO voice_demo_invitations
      (voice_business_profile_id, prospect_id, access_code, recipient_email, demo_phone_number, profile_snapshot_json, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now', ?))
  `).bind(id, profile.lead_id ?? null, accessCode, recipientEmail, demoNumber, JSON.stringify(profile), `+${expiresInDays} days`).run();
  const invitationId = Number(inserted.meta.last_row_id);
  const prettyNumber = demoNumber.replace(/^\+1(\d{3})(\d{3})(\d{4})$/, '($1) $2-$3');
  const subject = `Your ${String(profile.business_name)} receptionist demo`;
  const text = [`Your personalized automated receptionist demo is ready.`, '', `Call: ${prettyNumber}`, `Access code: ${accessCode}`, '', `When prompted, enter or say the six-digit code. This invitation expires in ${expiresInDays} days.`, '', 'Shaun Carl Designs'].join('\n');
  try {
    await sendEmail(c.env.RESEND_API_KEY, { to: recipientEmail, from: c.env.OUTREACH_EMAIL_FROM || 'Shaun Carl Designs <info@shauncarldesigns.com>', replyTo: c.env.OUTREACH_EMAIL_REPLY_TO, subject, text, html: `<h2>Your personalized automated receptionist demo is ready</h2><p><strong>Call:</strong> ${prettyNumber}</p><p><strong>Access code:</strong> <span style="font-size:22px;letter-spacing:3px">${accessCode}</span></p><p>When prompted, enter or say the six-digit code. This invitation expires in ${expiresInDays} days.</p><p>Shaun Carl Designs</p>`, tags: [{ name: 'voice_demo_invitation_id', value: String(invitationId) }] });
    await c.env.DB.prepare(`UPDATE voice_demo_invitations SET sent_at=datetime('now') WHERE id=?`).bind(invitationId).run();
  } catch (error) {
    await c.env.DB.prepare(`DELETE FROM voice_demo_invitations WHERE id=?`).bind(invitationId).run();
    throw error;
  }
  const invitation = await c.env.DB.prepare(`SELECT * FROM voice_demo_invitations WHERE id=?`).bind(invitationId).first();
  return c.json({ invitation }, 201);
});

voiceRouter.post('/mock-calls', async (c) => {
  if (retellMode(c.env) !== 'mock') return c.json(badRequest('Mock calls are disabled in live mode'), 400);
  const body = await c.req.json().catch(() => ({})) as { profileId?: number; classification?: string };
  const profileId = Number(body.profileId);
  if (!Number.isInteger(profileId) || profileId <= 0) return c.json(badRequest('profileId is required'), 400);
  const profile = await c.env.DB.prepare(`SELECT * FROM voice_business_profiles WHERE id=?`).bind(profileId).first<Record<string, unknown>>();
  if (!profile) return c.json(notFound('Voice profile'), 404);
  const callId = `mock_${crypto.randomUUID()}`;
  const classification = body.classification === 'cold_sales' ? 'cold_sales' : 'new_customer';
  await c.env.DB.prepare(`
    INSERT INTO voice_calls (voice_business_profile_id, retell_call_id, environment, from_number, to_number, mode_at_start, started_at, ended_at, duration_seconds, call_successful, sentiment, summary, transcript, classification, final_outcome, raw_metadata_json)
    VALUES (?, ?, 'mock', '+19205550199', ?, ?, datetime('now','-75 seconds'), datetime('now'), 75, 1, 'positive', ?, ?, ?, ?, ?)
  `).bind(
    profileId, callId, profile.public_phone_number ?? 'Retell number pending', profile.default_mode,
    classification === 'new_customer' ? 'Caller requested website help and asked for a callback.' : 'A sales solicitation was screened without transferring.',
    classification === 'new_customer' ? 'Receptionist: Thanks for calling. How can I help?\nCaller: I would like information and a callback.' : 'Receptionist: May I ask what your call is regarding?\nCaller: This is a sales call.',
    classification, classification === 'new_customer' ? 'callback_requested' : 'screened',
    JSON.stringify({ mock: true }),
  ).run();
  const call = await c.env.DB.prepare(`SELECT * FROM voice_calls WHERE retell_call_id=?`).bind(callId).first<Record<string, unknown>>();
  if (call?.id) {
    const voiceLeadId = await syncVoiceLeadFromCall(c.env.DB, {
      callId: Number(call.id), profileId, classification, callerPhone: '+19205550199',
      intake: classification === 'new_customer' ? { callerName: 'Mock Customer', callbackNumber: '+19205550199', requestedService: 'Requested service information', urgency: 'normal' } : {},
      notes: String(call.summary ?? ''),
    });
    if (voiceLeadId) await notifyVoiceLead(c.env, voiceLeadId);
  }
  return c.json({ call }, 201);
});

voiceRouter.post('/mock-transfer-failures', async (c) => {
  if (retellMode(c.env) !== 'mock') return c.json(badRequest('Mock transfer failures are disabled in live mode'), 400);
  const body = await c.req.json().catch(() => ({})) as { profileId?: number };
  const profileId = Number(body.profileId);
  if (!Number.isInteger(profileId) || profileId <= 0) return c.json(badRequest('profileId is required'), 400);
  const profile = await c.env.DB.prepare(`SELECT * FROM voice_business_profiles WHERE id=?`).bind(profileId).first<Record<string, unknown>>();
  if (!profile) return c.json(notFound('Voice profile'), 404);
  const callId = `mock_transfer_${crypto.randomUUID()}`;
  const inserted = await c.env.DB.prepare(`
    INSERT INTO voice_calls (voice_business_profile_id, retell_call_id, environment, from_number, to_number, mode_at_start, started_at, ended_at, duration_seconds, disconnection_reason, call_successful, summary, classification, final_outcome, raw_metadata_json)
    VALUES (?, ?, 'mock', '+19205550197', ?, ?, datetime('now','-45 seconds'), datetime('now'), 45, 'transfer_cancelled', 0, 'A test transfer was cancelled before it connected.', 'existing_customer', 'transfer_failed', ?)
  `).bind(profileId, callId, profile.public_phone_number ?? 'Retell number pending', profile.default_mode, JSON.stringify({ mock: true, event: 'transfer_cancelled' })).run();
  const storedId = Number(inserted.meta.last_row_id);
  await notifyFailedTransfer(c.env, storedId);
  const call = await c.env.DB.prepare(`SELECT * FROM voice_calls WHERE id=?`).bind(storedId).first();
  return c.json({ call }, 201);
});

voiceRouter.post('/mock-webhook-failures', async (c) => {
  if (retellMode(c.env) !== 'mock') return c.json(badRequest('Webhook fixtures are disabled in live mode'), 400);
  const profile = await c.env.DB.prepare(`SELECT * FROM voice_business_profiles WHERE profile_kind='test' ORDER BY id LIMIT 1`).first<Record<string, unknown>>();
  if (!profile) return c.json(notFound('Internal test profile'), 404);
  const callId = `fixture_recovery_${crypto.randomUUID()}`;
  const payload = {
    event: 'call_analyzed',
    call: {
      call_id: callId, direction: 'inbound', from_number: '+19205550196', to_number: profile.public_phone_number ?? '+19999999999',
      start_timestamp: Date.now() - 60_000, end_timestamp: Date.now(), disconnection_reason: 'user_hangup', transcript: 'Synthetic webhook recovery fixture.',
      metadata: { voice_business_profile_id: profile.id }, retell_llm_dynamic_variables: { operating_mode: profile.default_mode },
      call_analysis: { call_successful: true, user_sentiment: 'positive', call_summary: 'Recovered synthetic customer request.', custom_analysis_data: {
        caller_classification: 'new_customer', caller_name: 'Recovery Test', callback_number: '+19205550196', caller_email: '',
        service_requested: 'Synthetic recovery test', location: 'Green Bay, WI', urgency: 'normal', preferred_timing: 'Tomorrow', final_outcome: 'callback_requested',
      } },
    },
  };
  const result = await c.env.DB.prepare(`INSERT INTO voice_webhook_events (event_type, provider_call_id, deduplication_key, payload_json, processing_status, processing_attempts, error_message) VALUES ('call_analyzed', ?, ?, ?, 'failed', 1, 'Synthetic recoverable failure')`).bind(callId, `fixture:${callId}`, JSON.stringify(payload)).run();
  const event = await c.env.DB.prepare(`SELECT id, event_type, provider_call_id, processing_attempts, received_at, error_message FROM voice_webhook_events WHERE id=?`).bind(result.meta.last_row_id).first();
  return c.json({ event }, 201);
});

voiceRouter.get('/agent-spec', (c) => c.json({
  rules: VOICE_AGENT_RULES,
  scenarios: [
    { id: 'new_customer', label: 'New customer', opening: 'Hi, I need an estimate for a repair at my house.' },
    { id: 'existing_customer', label: 'Existing customer', opening: 'I am an existing customer calling about the job you did last week.' },
    { id: 'emergency', label: 'After-hours emergency', opening: 'This is an emergency. A pipe burst and water is flooding the basement.' },
    { id: 'after_hours', label: 'Normal after-hours lead', opening: 'I would like to schedule an estimate sometime next week.' },
    { id: 'cold_sales', label: 'Cold salesperson', opening: 'I am calling to sell you an SEO and advertising package.' },
    { id: 'uncertain', label: 'Uncertain caller', opening: 'I need to speak with whoever handles service calls.' },
  ],
}));

voiceRouter.post('/simulator/qa', async (c) => {
  const body = await c.req.json().catch(() => ({})) as { profileId?: number; useAi?: boolean };
  const profileId = Number(body.profileId);
  if (!Number.isInteger(profileId) || profileId <= 0) return c.json(badRequest('profileId is required'), 400);
  const profile = await c.env.DB.prepare(`SELECT * FROM voice_business_profiles WHERE id=?`).bind(profileId).first<Record<string, unknown>>();
  if (!profile) return c.json(notFound('Voice profile'), 404);
  const cases: Array<{ id: string; label: string; message: string; expected: VoiceClassification; expectedOutcome?: string }> = [
    { id: 'new_customer', label: 'New customer', message: 'Hi, I need an estimate for a repair at my house.', expected: 'new_customer' },
    { id: 'existing_customer', label: 'Existing customer', message: 'I am an existing customer calling about the job you did last week.', expected: 'existing_customer' },
    { id: 'emergency', label: 'Emergency', message: 'A pipe burst and water is flooding my basement. This is an emergency.', expected: 'emergency' },
    { id: 'cold_sales', label: 'Cold salesperson', message: 'I am calling to sell your company an SEO and advertising package.', expected: 'cold_sales', expectedOutcome: 'screened' },
    { id: 'applicant', label: 'Applicant', message: 'I am calling about a job application. Are you hiring?', expected: 'applicant' },
    { id: 'spam', label: 'Spam', message: 'This is a robocall about your extended warranty.', expected: 'spam', expectedOutcome: 'screened' },
  ];
  const results = await Promise.all(cases.map(async (testCase) => {
    const input = { businessName: String(profile.business_name), services: String(profile.services_text ?? ''), serviceArea: String(profile.service_area_text ?? ''), hours: String(profile.hours_text ?? ''), businessRules: String(profile.configuration_json ?? '{}'), history: [] as SimulatorTurn[], message: testCase.message, classification: 'unknown' as VoiceClassification, intake: {} as VoiceIntake };
    let result;
    if (body.useAi === true && c.env.OPENAI_API_KEY) {
      try { result = await simulateReceptionistTurnAI({ ...input, apiKey: c.env.OPENAI_API_KEY, model: c.env.VOICE_PREVIEW_MODEL }); }
      catch { result = { ...simulateReceptionistTurn(input), engine: 'rules' as const }; }
    } else result = { ...simulateReceptionistTurn(input), engine: 'rules' as const };
    const unsafePromise = /\b(right away|immediate callback|emergency team|transfer you|connect you|pull up your records|look up your records|access your records|shut off|turn off the (?:water|power|gas)|electrical hazards?|repair it yourself)\b/i.test(result.reply);
    const outcomePassed = !testCase.expectedOutcome || result.outcome === testCase.expectedOutcome;
    return { id: testCase.id, label: testCase.label, expected: testCase.expected, actual: result.classification, expectedOutcome: testCase.expectedOutcome ?? null, actualOutcome: result.outcome, passed: result.classification === testCase.expected && outcomePassed && !unsafePromise, engine: result.engine, reply: result.reply, issues: [...(!outcomePassed ? [`Expected ${testCase.expectedOutcome} outcome`] : []), ...(unsafePromise ? ['Contains an unsupported transfer or response-time promise'] : [])] };
  }));
  const passed = results.filter((row) => row.passed).length;
  const run = await c.env.DB.prepare(`INSERT INTO voice_qa_runs (voice_business_profile_id, requested_engine, model, prompt_version, passed_count, total_count) VALUES (?, ?, ?, ?, ?, ?)`).bind(
    profileId, body.useAi === true ? 'openai' : 'rules', body.useAi === true ? (c.env.VOICE_PREVIEW_MODEL || 'gpt-4.1-mini') : null,
    VOICE_AGENT_PROMPT_VERSION, passed, results.length,
  ).run();
  const runId = Number(run.meta.last_row_id);
  await c.env.DB.batch(results.map((row) => c.env.DB.prepare(`INSERT INTO voice_qa_cases (qa_run_id, case_key, label, expected_classification, actual_classification, expected_outcome, actual_outcome, engine, passed, reply, issues_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
    runId, row.id, row.label, row.expected, row.actual, row.expectedOutcome, row.actualOutcome, row.engine, row.passed ? 1 : 0, row.reply, JSON.stringify(row.issues),
  )));
  return c.json({ runId, results, passed, total: results.length });
});

voiceRouter.post('/simulator/respond', async (c) => {
  const length = Number(c.req.header('content-length') ?? 0);
  if (length > 32_768) return c.json(badRequest('Simulation payload is too large'), 413);
  const body = await c.req.json().catch(() => ({})) as {
    profileId?: number;
    history?: SimulatorTurn[];
    message?: string;
    classification?: VoiceClassification;
    intake?: VoiceIntake;
    useAi?: boolean;
  };
  const profileId = Number(body.profileId);
  const message = typeof body.message === 'string' ? body.message.trim() : '';
  if (!Number.isInteger(profileId) || profileId <= 0 || !message) return c.json(badRequest('profileId and message are required'), 400);
  const profile = await c.env.DB.prepare(`SELECT * FROM voice_business_profiles WHERE id=?`).bind(profileId).first<Record<string, unknown>>();
  if (!profile) return c.json(notFound('Voice profile'), 404);
  const history = Array.isArray(body.history)
    ? body.history.slice(-24).filter((turn): turn is SimulatorTurn => Boolean(turn) && (turn.role === 'caller' || turn.role === 'receptionist') && typeof turn.text === 'string')
    : [];
  const simulationInput = {
    businessName: String(profile.business_name), services: String(profile.services_text ?? ''),
    serviceArea: String(profile.service_area_text ?? ''), hours: String(profile.hours_text ?? ''), businessRules: String(profile.configuration_json ?? '{}'),
    history, message: message.slice(0, 2_000), classification: body.classification, intake: body.intake,
  };
  let result;
  if (body.useAi === true && c.env.OPENAI_API_KEY) {
    try { result = await simulateReceptionistTurnAI({ ...simulationInput, apiKey: c.env.OPENAI_API_KEY, model: c.env.VOICE_PREVIEW_MODEL }); }
    catch { result = { ...simulateReceptionistTurn(simulationInput), engine: 'rules' as const }; }
  } else result = { ...simulateReceptionistTurn(simulationInput), engine: 'rules' as const };
  return c.json({ result });
});

voiceRouter.post('/simulator/complete', async (c) => {
  if (retellMode(c.env) !== 'mock') return c.json(badRequest('Text simulations are disabled in live mode'), 400);
  const length = Number(c.req.header('content-length') ?? 0);
  if (length > 64_000) return c.json(badRequest('Simulation payload is too large'), 413);
  const body = await c.req.json().catch(() => ({})) as {
    profileId?: number;
    history?: SimulatorTurn[];
    classification?: VoiceClassification;
    confidence?: string;
    intake?: VoiceIntake;
    outcome?: string;
  };
  const profileId = Number(body.profileId);
  if (!Number.isInteger(profileId) || profileId <= 0) return c.json(badRequest('profileId is required'), 400);
  const profile = await c.env.DB.prepare(`SELECT * FROM voice_business_profiles WHERE id=?`).bind(profileId).first<Record<string, unknown>>();
  if (!profile) return c.json(notFound('Voice profile'), 404);
  const history = Array.isArray(body.history)
    ? body.history.slice(-30).filter((turn): turn is SimulatorTurn => Boolean(turn) && (turn.role === 'caller' || turn.role === 'receptionist') && typeof turn.text === 'string')
    : [];
  if (history.length < 2) return c.json(badRequest('A simulation needs at least one caller exchange'), 400);
  const classification = body.classification ?? 'unknown';
  const intake = body.intake ?? {};
  const transcript = history.map((turn) => `${turn.role === 'caller' ? 'Caller' : 'Receptionist'}: ${turn.text.slice(0, 2_000)}`).join('\n');
  const callId = `simulation_${crypto.randomUUID()}`;
  const summary = summarizeSimulation(classification, intake);
  const outcome = typeof body.outcome === 'string' ? body.outcome : 'message_taken';
  const startedSecondsAgo = Math.max(15, history.length * 12);
  await c.env.DB.prepare(`
    INSERT INTO voice_calls (
      voice_business_profile_id, prospect_id, retell_call_id, environment, from_number,
      to_number, mode_at_start, started_at, ended_at, duration_seconds, call_successful,
      sentiment, summary, transcript, classification, final_outcome, raw_metadata_json
    ) VALUES (?, ?, ?, 'mock', 'browser simulator', ?, ?, datetime('now', ?), datetime('now'), ?, 1,
      'neutral', ?, ?, ?, ?, ?)
  `).bind(
    profileId, profile.lead_id ?? null, callId, profile.public_phone_number ?? 'Retell number pending',
    profile.default_mode ?? 'intake_only', `-${startedSecondsAgo} seconds`, startedSecondsAgo,
    summary, transcript, classification, outcome,
    JSON.stringify({ source: 'text_simulator', confidence: body.confidence ?? 'unknown', intake }),
  ).run();
  const call = await c.env.DB.prepare(`SELECT * FROM voice_calls WHERE retell_call_id=?`).bind(callId).first<Record<string, unknown>>();
  if (call?.id) {
    const voiceLeadId = await syncVoiceLeadFromCall(c.env.DB, { callId: Number(call.id), profileId, classification, callerPhone: null, intake, notes: summary });
    if (voiceLeadId) await notifyVoiceLead(c.env, voiceLeadId);
  }
  return c.json({ call }, 201);
});

voiceRouter.get('/calls/:id/recording', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id <= 0) return c.json(badRequest('Invalid call ID'), 400);
  const call = await c.env.DB.prepare(`SELECT recording_url FROM voice_calls WHERE id=?`).bind(id).first<{ recording_url: string | null }>();
  if (!call) return c.json(notFound('Voice call'), 404);
  if (!call.recording_url) return c.json(notFound('Call recording'), 404);

  let recordingUrl: URL;
  try { recordingUrl = new URL(call.recording_url); } catch { return c.text('Invalid recording location', 502); }
  if (recordingUrl.protocol !== 'https:' || !recordingUrl.hostname.endsWith('.cloudfront.net')) return c.text('Untrusted recording location', 502);

  const range = c.req.header('range');
  const upstream = await fetch(recordingUrl.toString(), { headers: range ? { Range: range } : undefined });
  if (!upstream.ok && upstream.status !== 206) return c.text(`Recording provider returned ${upstream.status}`, 502);
  const headers = new Headers({
    'Content-Type': upstream.headers.get('content-type') || 'audio/mpeg',
    'Cache-Control': 'private, max-age=300',
    'Accept-Ranges': upstream.headers.get('accept-ranges') || 'bytes',
  });
  for (const name of ['content-length', 'content-range']) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  return new Response(upstream.body, { status: upstream.status, headers });
});

voiceRouter.put('/calls/:id/review', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id <= 0) return c.json(badRequest('Invalid call ID'), 400);
  const call = await c.env.DB.prepare(`SELECT * FROM voice_calls WHERE id=?`).bind(id).first<Record<string, unknown>>();
  if (!call) return c.json(notFound('Voice call'), 404);
  const body = await c.req.json().catch(() => ({})) as {
    classification?: VoiceClassification;
    finalOutcome?: string;
    summary?: string;
    reviewStatus?: 'unreviewed' | 'passed' | 'needs_work';
    reviewNotes?: string;
  };
  const classifications: VoiceClassification[] = ['new_customer','existing_customer','emergency','personal_vip','vendor','applicant','cold_sales','spam','unknown'];
  if (body.classification && !classifications.includes(body.classification)) return c.json(badRequest('Invalid classification'), 400);
  if (body.reviewStatus && !['unreviewed','passed','needs_work'].includes(body.reviewStatus)) return c.json(badRequest('Invalid review status'), 400);
  let metadata: Record<string, unknown> = {};
  try { metadata = JSON.parse(String(call.raw_metadata_json ?? '{}')) as Record<string, unknown>; } catch { metadata = {}; }
  metadata.review = {
    status: body.reviewStatus ?? 'unreviewed',
    notes: typeof body.reviewNotes === 'string' ? body.reviewNotes.trim().slice(0, 2_000) : '',
    reviewed_at: new Date().toISOString(),
  };
  await c.env.DB.prepare(`
    UPDATE voice_calls SET classification=?, final_outcome=?, summary=?, raw_metadata_json=?, updated_at=datetime('now') WHERE id=?
  `).bind(
    body.classification ?? call.classification ?? 'unknown',
    typeof body.finalOutcome === 'string' ? body.finalOutcome.trim().slice(0, 100) : call.final_outcome,
    typeof body.summary === 'string' ? body.summary.trim().slice(0, 2_000) : call.summary,
    JSON.stringify(metadata), id,
  ).run();
  const nextClassification = body.classification ?? call.classification ?? 'unknown';
  const savedMetadata = metadata as { intake?: VoiceIntake };
  const voiceLeadId = await syncVoiceLeadFromCall(c.env.DB, {
    callId: id,
    profileId: Number(call.voice_business_profile_id) || null,
    classification: nextClassification as VoiceClassification,
    callerPhone: typeof call.from_number === 'string' ? call.from_number : null,
    intake: savedMetadata.intake,
    notes: typeof body.summary === 'string' ? body.summary : typeof call.summary === 'string' ? call.summary : null,
  });
  if (voiceLeadId) await notifyVoiceLead(c.env, voiceLeadId);
  if (nextClassification === 'cold_sales' || nextClassification === 'spam') {
    await c.env.DB.prepare(`UPDATE voice_leads SET status='spam', updated_at=datetime('now') WHERE source_call_id=?`).bind(id).run();
  } else if (['new_customer','emergency','unknown'].includes(String(nextClassification))) {
    await c.env.DB.prepare(`UPDATE voice_leads SET status='new', updated_at=datetime('now') WHERE source_call_id=? AND status='spam'`).bind(id).run();
  }
  const reviewed = await c.env.DB.prepare(`SELECT c.*, p.business_name FROM voice_calls c LEFT JOIN voice_business_profiles p ON p.id=c.voice_business_profile_id WHERE c.id=?`).bind(id).first();
  return c.json({ call: reviewed });
});
