import { Hono, type Context } from 'hono';
import type { Env } from '../types';
import { verifyRetellSignature } from '../services/retellSignature';
import { resolveVoiceDemo, voiceDynamicVariables } from '../services/voiceDemo';
import { syncVoiceLeadFromCall } from '../services/voiceLead';
import { notifyFailedTransfer, notifyVoiceLead } from '../services/voiceNotification';
import type { VoiceClassification, VoiceIntake } from '../services/voiceAgent';

export const retellWebhookRouter = new Hono<{ Bindings: Env }>();
const MAX_WEBHOOK_BYTES = 1_000_000;

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

  const resolved = await resolveVoiceDemo(c.env.DB, fromNumber, toNumber);
  if (!resolved) return c.json({ call_inbound: {} });
  const agentId = resolved.profile.retell_agent_id || c.env.RETELL_DEFAULT_AGENT_ID;
  if (!agentId) return c.json({ call_inbound: {} });

  return c.json({
    call_inbound: {
      override_agent_id: agentId,
      ...(resolved.profile.retell_agent_version ? { override_agent_version: resolved.profile.retell_agent_version } : {}),
      dynamic_variables: voiceDynamicVariables(resolved),
      metadata: {
        voice_business_profile_id: resolved.profile.id,
        demo_session_id: resolved.demoSessionId,
        prospect_id: resolved.prospectId,
      },
    },
  });
});

export async function processRetellEventPayload(env: Env, payload: Record<string, unknown>, eventType: string, waitUntil: (promise: Promise<unknown>) => void): Promise<void> {
  const call = objectOrEmpty(payload.call);
  const callId = stringOrNull(call.call_id);
  if (!callId) return;
  const metadata = objectOrEmpty(call.metadata);
  const analysis = objectOrEmpty(call.call_analysis);
  const custom = objectOrEmpty(analysis.custom_analysis_data);
  const profileId = numberOrNull(metadata.voice_business_profile_id);
  const demoSessionId = numberOrNull(metadata.demo_session_id);
  const prospectId = numberOrNull(metadata.prospect_id);
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
    stringOrNull(custom.final_outcome), JSON.stringify(metadata),
  ).run();
  const storedCall = await env.DB.prepare(`SELECT id FROM voice_calls WHERE retell_call_id=?`).bind(callId).first<{ id: number }>();
  const classification = voiceClassification(custom.caller_classification);
  if (storedCall && stringOrNull(custom.caller_classification)) {
    const intake: VoiceIntake = {
      callerName: stringOrNull(custom.caller_name) ?? undefined, callbackNumber: stringOrNull(custom.callback_number) ?? undefined,
      callerEmail: stringOrNull(custom.caller_email) ?? undefined, requestedService: stringOrNull(custom.service_requested) ?? undefined,
      location: stringOrNull(custom.location) ?? undefined, urgency: stringOrNull(custom.urgency) ?? undefined,
      preferredTiming: stringOrNull(custom.preferred_timing) ?? undefined,
    };
    const voiceLeadId = await syncVoiceLeadFromCall(env.DB, { callId: storedCall.id, profileId, classification, callerPhone: stringOrNull(call.from_number), intake, notes: stringOrNull(analysis.call_summary) });
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
