import type { VoiceClassification, VoiceIntake } from './voiceAgent';

const OPPORTUNITY_CLASSIFICATIONS = new Set<VoiceClassification>(['new_customer', 'emergency', 'unknown']);

export async function syncVoiceLeadFromCall(db: D1Database, input: {
  callId: number;
  profileId: number | null;
  classification: VoiceClassification;
  callerPhone?: string | null;
  intake?: VoiceIntake;
  notes?: string | null;
}): Promise<number | null> {
  if (!input.profileId || !OPPORTUNITY_CLASSIFICATIONS.has(input.classification)) return null;
  const intake = input.intake ?? {};
  const status = input.classification === 'unknown' ? 'new' : 'new';
  const location = intake.location?.trim() || null;
  const postalCode = location && /^\d{5}(?:-\d{4})?$/.test(location) ? location : null;
  const city = postalCode ? null : location;
  await db.prepare(`
    INSERT INTO voice_leads (
      voice_business_profile_id, source_call_id, caller_name, caller_phone, caller_email,
      service_requested, service_address, city, postal_code, urgency, preferred_timing,
      intake_notes, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(source_call_id) DO UPDATE SET
      caller_name=COALESCE(excluded.caller_name, voice_leads.caller_name),
      caller_phone=COALESCE(excluded.caller_phone, voice_leads.caller_phone),
      caller_email=COALESCE(excluded.caller_email, voice_leads.caller_email),
      service_requested=COALESCE(excluded.service_requested, voice_leads.service_requested),
      service_address=COALESCE(excluded.service_address, voice_leads.service_address),
      city=COALESCE(excluded.city, voice_leads.city),
      postal_code=COALESCE(excluded.postal_code, voice_leads.postal_code),
      urgency=CASE WHEN excluded.urgency='unknown' THEN voice_leads.urgency ELSE excluded.urgency END,
      preferred_timing=COALESCE(excluded.preferred_timing, voice_leads.preferred_timing),
      intake_notes=COALESCE(excluded.intake_notes, voice_leads.intake_notes),
      updated_at=datetime('now')
  `).bind(
    input.profileId, input.callId, intake.callerName ?? null, intake.callbackNumber ?? input.callerPhone ?? null,
    intake.callerEmail ?? null, intake.requestedService ?? null, null, city, postalCode,
    intake.urgency ?? (input.classification === 'emergency' ? 'emergency' : 'unknown'),
    intake.preferredTiming ?? null, input.notes ?? null, status,
  ).run();
  const row = await db.prepare(`SELECT id FROM voice_leads WHERE source_call_id=?`).bind(input.callId).first<{ id: number }>();
  return row?.id ?? null;
}
