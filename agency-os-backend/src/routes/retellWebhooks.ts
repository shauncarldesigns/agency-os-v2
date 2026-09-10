import { Hono, type Context } from 'hono';
import type { Env } from '../types';
import { verifyRetellSignature } from '../services/retellSignature';
import { resolveVoiceDemo, voiceDynamicVariables } from '../services/voiceDemo';
import { syncVoiceLeadFromCall } from '../services/voiceLead';
import { notifyFailedTransfer, notifyVoiceLead } from '../services/voiceNotification';
import type { VoiceClassification, VoiceIntake } from '../services/voiceAgent';

export const retellWebhookRouter = new Hono<{ Bindings: Env }>();
const MAX_WEBHOOK_BYTES = 1_000_000;
const INBOUND_SECOND_RING_DELAY_MS = 7_000;

function isoFromMilliseconds(value: unknown): string | null {
  const milliseconds = Number(value);
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) return null;
  return new Date(milliseconds).toISOString();
}

function numberOrNull(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function objectOrEmpty(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function voiceClassification(value: unknown): VoiceClassification {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return ['new_customer','existing_customer','emergency','personal_vip','vendor','applicant','cold_sales','spam','unknown'].includes(normalized)
    ? normalized as VoiceClassification : 'unknown';
}

async function verifiedPayload(c: Context<{ Bindings: Env }>): Promise<{ raw: string; payload: Record<string, unknown> } | Response> {
  const contentLength = Number(c.req.header('content-length') ?? 0);
  if (contentLength > MAX_WEBHOOK_BYTES) return c.text('Payload too large', 413);
  const raw = await c.req.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_WEBHOOK_BYTES) return c.text('Payload too large', 413);
  if (!c.env.RETELL_API_KEY) return c.text('Retell is not configured', 503);
  const valid = await verifyRetellSignature(raw, c.req.header('x-retell-signature') ?? null, c.env.RETELL_API_KEY);
  if (!valid) return c.text('Invalid signature', 401);
  try {
    return { raw, payload: JSON.parse(raw) as Record<string, unknown> };
  } catch {
    return c.text('Invalid JSON', 400);
  }
}

retellWebhookRouter.post('/webhooks/retell/inbound', async (c) => {
  const verified = await verifiedPayload(c);
  if (verified instanceof Response) return verified;
  const inbound = objectOrEmpty(verified.payload.call_inbound);
  const fromNumber = stringOrNull(inbound.from_number);
  const toNumber = stringOrNull(inbound.to_number);
  if (!fromNumber || !toNumber) return c.text('Missing call numbers', 400);

  // Retell keeps the inbound call ringing while awaiting this response.
  // This targets a second-ring pickup while remaining below its 10-second
  // inbound webhook timeout.
  await new Promise((resolve) => setTimeout(resolve, INBOUND_SECOND_RING_DELAY_MS));

  const resolved = await resolveVoiceDemo(c.env.DB, fromNumber, toNumber);
  if (!resolved) return c.json({ call_inbound: {} });
  const agentId = resolved.profile.retell_agent_id || c.env.RETELL_DEFAULT_AGENT_ID;
  if (!agentId) return c.json({ call_inbound: {} });
  const requiresAccessCode = resolved.demoSessionId === null && resolved.profile.profile_kind === 'test';
  const variables = voiceDynamicVariables(resolved);
  const conferenceDemo = resolved.demoSessionId !== null;
  const beginMessage = requiresAccessCode
    ? 'Thanks for calling the automated receptionist demo line. What is your six-digit access code?'
    : conferenceDemo
      ? `Hi, this is ${variables.receptionist_name}. Your demo receptionist is ready. Merge the calls, then say, “${variables.receptionist_name}, we’re ready to start the demo.”`
      : null;

  return c.json({
    call_inbound: {
      override_agent_id: agentId,
      ...(resolved.profile.retell_agent_version ? { override_agent_version: resolved.profile.retell_agent_version } : {}),
      ...(beginMessage ? { agent_override: { retell_llm: { begin_message: beginMessage } } } : {}),
      dynamic_variables: { ...variables, access_code_required: requiresAccessCode ? 'true' : 'false' },
      metadata: {
        voice_business_profile_id: resolved.profile.id,
        demo_session_id: resolved.demoSessionId,
        prospect_id: resolved.prospectId,
      },
    },
  });
});

retellWebhookRouter.post('/webhooks/retell/demo-code', async (c) => {
  const verified = await verifiedPayload(c);
  if (verified instanceof Response) return verified;
  const args = objectOrEmpty(verified.payload.args);
  const call = objectOrEmpty(verified.payload.call);
  const accessCode = String(args.access_code ?? '').replace(/\D/g, '');
  if (accessCode.length !== 6) return c.json({ valid: false, message: 'That code should contain six digits. Ask the caller to repeat it once.' });
  const invitation = await c.env.DB.prepare(`
    SELECT i.*, p.retell_agent_id
      FROM voice_demo_invitations i
      JOIN voice_business_profiles p ON p.id=i.voice_business_profile_id
     WHERE i.access_code=? AND i.status='active' AND i.expires_at > datetime('now')
     LIMIT 1
  `).bind(accessCode).first<Record<string, unknown>>();
  if (!invitation) return c.json({ valid: false, message: 'That code is invalid or expired. Ask the caller to check the email and repeat it once. Do not reveal any business information.' });
  let profile: Record<string, unknown>;
  try { profile = JSON.parse(String(invitation.profile_snapshot_json)) as Record<string, unknown>; } catch { return c.json({ valid: false, message: 'The demo profile could not be loaded. Ask the caller to contact Shaun Carl Designs.' }); }
  const callId = stringOrNull(call.call_id);
  if (callId) {
    const used = await c.env.DB.prepare(`INSERT OR IGNORE INTO voice_demo_invitation_uses (invitation_id, retell_call_id, caller_phone) VALUES (?, ?, ?)`).bind(invitation.id, callId, stringOrNull(call.from_number)).run();
    if ((used.meta.changes ?? 0) > 0) await c.env.DB.prepare(`UPDATE voice_demo_invitations SET use_count=use_count+1, last_used_at=datetime('now') WHERE id=?`).bind(invitation.id).run();
  }
  return c.json({
    valid: true,
    invitation_id: invitation.id,
    profile_id: invitation.voice_business_profile_id,
    prospect_id: invitation.prospect_id,
    business_name: profile.business_name,
    greeting: profile.greeting,
    services: profile.services_text,
    service_area: profile.service_area_text,
    business_hours: profile.hours_text,
    business_rules: profile.configuration_json ?? '{}',
    message: `The code is valid. Introduce the personalized demo for ${String(profile.business_name)} and invite the caller to pretend they are a customer calling that business.`,
  });
});

export async function processRetellEventPayload(env: Env, payload: Record<string, unknown>, eventType: string, waitUntil: (promise: Promise<unknown>) => void): Promise<void> {
  const call = objectOrEmpty(payload.call);
  const callId = stringOrNull(call.call_id);
  if (!callId) return;
  const metadata = objectOrEmpty(call.metadata);
  const analysis = objectOrEmpty(call.call_analysis);
  const custom = objectOrEmpty(analysis.custom_analysis_data);
  const extractedIntake: VoiceIntake = {
    callerName: stringOrNull(custom.caller_name) ?? undefined,
    callbackNumber: stringOrNull(custom.callback_number) ?? undefined,
    callerEmail: stringOrNull(custom.caller_email) ?? undefined,
    requestedService: stringOrNull(custom.service_requested) ?? undefined,
    location: stringOrNull(custom.location) ?? undefined,
    urgency: stringOrNull(custom.urgency) ?? undefined,
    preferredTiming: stringOrNull(custom.preferred_timing) ?? undefined,
  };
  const invitationUse = await env.DB.prepare(`SELECT i.id AS invitation_id, i.voice_business_profile_id, i.prospect_id FROM voice_demo_invitation_uses u JOIN voice_demo_invitations i ON i.id=u.invitation_id WHERE u.retell_call_id=? ORDER BY u.id DESC LIMIT 1`).bind(callId).first<{ invitation_id: number; voice_business_profile_id: number; prospect_id: number | null }>();
  const profileId = invitationUse?.voice_business_profile_id ?? numberOrNull(metadata.voice_business_profile_id);
  const demoSessionId = numberOrNull(metadata.demo_session_id);
  const prospectId = invitationUse?.prospect_id ?? numberOrNull(metadata.prospect_id);
  const startedAt = isoFromMilliseconds(call.start_timestamp);
  const endedAt = isoFromMilliseconds(call.end_timestamp);
  const durationSeconds = startedAt && endedAt ? Math.max(0, Math.round((Date.parse(endedAt) - Date.parse(startedAt)) / 1000)) : null;
  await env.DB.prepare(`
    INSERT INTO voice_calls (
      voice_business_profile_id, prospect_id, demo_session_id, retell_call_id, environment,
      direction, from_number, to_number, mode_at_start, started_at, ended_at,
      duration_seconds, disconnection_reason, call_successful, sentiment, summary,
      transcript, recording_url, total_cost, classification, final_outcome, raw_metadata_json
    ) VALUES (
      ?, ?, ?, ?, 'demo',
      ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?
    )
    ON CONFLICT(retell_call_id) DO UPDATE SET
      voice_business_profile_id=COALESCE(excluded.voice_business_profile_id, voice_calls.voice_business_profile_id),
      prospect_id=COALESCE(excluded.prospect_id, voice_calls.prospect_id),
      demo_session_id=COALESCE(excluded.demo_session_id, voice_calls.demo_session_id),
      direction=COALESCE(excluded.direction, voice_calls.direction), from_number=COALESCE(excluded.from_number, voice_calls.from_number),
      to_number=COALESCE(excluded.to_number, voice_calls.to_number), mode_at_start=COALESCE(excluded.mode_at_start, voice_calls.mode_at_start),
      started_at=COALESCE(excluded.started_at, voice_calls.started_at), ended_at=COALESCE(excluded.ended_at, voice_calls.ended_at),
      duration_seconds=COALESCE(excluded.duration_seconds, voice_calls.duration_seconds), disconnection_reason=COALESCE(excluded.disconnection_reason, voice_calls.disconnection_reason),
      call_successful=COALESCE(excluded.call_successful, voice_calls.call_successful), sentiment=COALESCE(excluded.sentiment, voice_calls.sentiment),
      summary=COALESCE(excluded.summary, voice_calls.summary), transcript=COALESCE(excluded.transcript, voice_calls.transcript),
      recording_url=COALESCE(excluded.recording_url, voice_calls.recording_url), total_cost=COALESCE(excluded.total_cost, voice_calls.total_cost),
      classification=COALESCE(excluded.classification, voice_calls.classification), final_outcome=COALESCE(excluded.final_outcome, voice_calls.final_outcome),
      raw_metadata_json=excluded.raw_metadata_json, updated_at=datetime('now')
  `).bind(
    profileId, prospectId, demoSessionId, callId,
    stringOrNull(call.direction) ?? 'inbound', stringOrNull(call.from_number), stringOrNull(call.to_number),
    stringOrNull(objectOrEmpty(call.retell_llm_dynamic_variables).operating_mode), startedAt, endedAt, durationSeconds,
    stringOrNull(call.disconnection_reason), typeof analysis.call_successful === 'boolean' ? (analysis.call_successful ? 1 : 0) : null,
    stringOrNull(analysis.user_sentiment), stringOrNull(analysis.call_summary), stringOrNull(call.transcript),
    stringOrNull(call.recording_url), numberOrNull(call.call_cost), stringOrNull(custom.caller_classification),
    stringOrNull(custom.final_outcome), JSON.stringify({ ...metadata, invitation_id: invitationUse?.invitation_id ?? null, intake: extractedIntake }),
  ).run();
  const storedCall = await env.DB.prepare(`SELECT id FROM voice_calls WHERE retell_call_id=?`).bind(callId).first<{ id: number }>();
  if (demoSessionId && (eventType === 'call_ended' || eventType === 'call_analyzed')) {
    await env.DB.prepare(`UPDATE voice_demo_sessions SET status='completed' WHERE id=? AND status='active'`).bind(demoSessionId).run();
  }
  const classification = voiceClassification(custom.caller_classification);
  if (storedCall && stringOrNull(custom.caller_classification)) {
    const voiceLeadId = await syncVoiceLeadFromCall(env.DB, { callId: storedCall.id, profileId, classification, callerPhone: stringOrNull(call.from_number), intake: extractedIntake, notes: stringOrNull(analysis.call_summary) });
    if (voiceLeadId) waitUntil(notifyVoiceLead(env, voiceLeadId));
  }
  if (storedCall && eventType === 'transfer_cancelled') waitUntil(notifyFailedTransfer(env, storedCall.id));
}

retellWebhookRouter.post('/webhooks/retell/events', async (c) => {
  const verified = await verifiedPayload(c);
  if (verified instanceof Response) return verified;
  const eventType = stringOrNull(verified.payload.event) ?? 'unknown';
  const call = objectOrEmpty(verified.payload.call);
  const callId = stringOrNull(call.call_id);
  const transferDestination = objectOrEmpty(verified.payload.transfer_destination);
  const eventTimestamp = stringOrNull(verified.payload.event_timestamp) ?? stringOrNull(call.last_modification_timestamp);
  const deduplicationKey = [eventType, callId ?? 'no-call', stringOrNull(transferDestination.number) ?? '', eventType.startsWith('transfer_') ? eventTimestamp ?? '' : ''].join(':');

  const inserted = await c.env.DB.prepare(`
    INSERT OR IGNORE INTO voice_webhook_events
      (event_type, provider_call_id, deduplication_key, payload_json)
    VALUES (?, ?, ?, ?)
  `).bind(eventType, callId, deduplicationKey, verified.raw).run();
  if ((inserted.meta.changes ?? 0) === 0) return c.body(null, 204);

  try {
    await processRetellEventPayload(c.env, verified.payload, eventType, (promise) => c.executionCtx.waitUntil(promise));
    await c.env.DB.prepare(`UPDATE voice_webhook_events SET processing_status='processed', processing_attempts=processing_attempts+1, processed_at=datetime('now') WHERE deduplication_key=?`).bind(deduplicationKey).run();
    return c.body(null, 204);
  } catch (error) {
    await c.env.DB.prepare(`UPDATE voice_webhook_events SET processing_status='failed', processing_attempts=processing_attempts+1, error_message=? WHERE deduplication_key=?`).bind((error as Error).message.slice(0, 500), deduplicationKey).run();
    throw error;
  }
});
