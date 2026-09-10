export interface VoiceProfileRow {
  id: number;
  profile_kind?: 'test' | 'prospect' | 'customer';
  lead_id: number | null;
  business_name: string;
  business_phone: string | null;
  timezone: string;
  greeting: string;
  services_text: string;
  service_area_text: string;
  hours_text: string;
  default_mode: string;
  transfer_enabled: number;
  emergency_transfer_enabled: number;
  private_transfer_destination: string | null;
  public_phone_number: string | null;
  retell_agent_id: string | null;
  retell_agent_version: number | null;
  configuration_json?: string;
}

export interface ResolvedVoiceDemo {
  profile: VoiceProfileRow;
  demoSessionId: number | null;
  prospectId: number | null;
}

export function normalizePhone(value: string | null | undefined): string {
  if (!value) return '';
  const trimmed = value.trim();
  const digits = trimmed.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return trimmed.startsWith('+') ? `+${digits}` : digits;
}

export async function resolveVoiceDemo(db: D1Database, fromNumber: string, toNumber: string): Promise<ResolvedVoiceDemo | null> {
  const caller = normalizePhone(fromNumber);
  const destination = normalizePhone(toNumber);
  const session = await db.prepare(`
    SELECT s.id AS demo_session_id, s.prospect_id, s.profile_snapshot_json
      FROM voice_demo_sessions s
     WHERE s.status = 'active'
       AND s.expires_at > datetime('now')
       AND s.caller_phone_match = ?
       AND (s.demo_phone_number IS NULL OR s.demo_phone_number = ?)
     ORDER BY s.activated_at DESC, s.id DESC
     LIMIT 1
  `).bind(caller, destination).first<{ demo_session_id: number; prospect_id: number | null; profile_snapshot_json: string }>();
  if (session) {
    try {
      return { profile: JSON.parse(session.profile_snapshot_json) as VoiceProfileRow, demoSessionId: session.demo_session_id, prospectId: session.prospect_id };
    } catch {
      // A malformed snapshot must not expose another profile. Fall through to
      // the generic internal profile instead.
    }
  }

  const fallback = await db.prepare(`
    SELECT * FROM voice_business_profiles
     WHERE profile_kind = 'test' AND status IN ('testing','ready','live')
     ORDER BY updated_at DESC, id DESC LIMIT 1
  `).first<VoiceProfileRow>();
  return fallback ? { profile: fallback, demoSessionId: null, prospectId: fallback.lead_id } : null;
}

export function voiceDynamicVariables(resolved: ResolvedVoiceDemo): Record<string, string> {
  const { profile } = resolved;
  return {
    business_id: String(profile.id),
    business_name: profile.business_name,
    business_phone: profile.business_phone ?? '',
    business_timezone: profile.timezone,
    operating_mode: profile.default_mode,
    current_hours_status: 'unknown',
    transfer_destination: profile.private_transfer_destination ?? '',
    transfer_enabled: profile.transfer_enabled === 1 ? 'true' : 'false',
    emergency_transfer_enabled: profile.emergency_transfer_enabled === 1 ? 'true' : 'false',
    demo_session_id: resolved.demoSessionId == null ? '' : String(resolved.demoSessionId),
    prospect_id: resolved.prospectId == null ? '' : String(resolved.prospectId),
    caller_type_if_known: 'unknown',
    greeting: profile.greeting,
    services: profile.services_text,
    service_area: profile.service_area_text,
    business_hours: profile.hours_text,
    business_rules: profile.configuration_json ?? '{}',
    access_code_required: 'false',
  };
}
