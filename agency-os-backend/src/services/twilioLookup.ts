import type { Env } from '../types';

export type PhoneRoute = 'text' | 'call' | 'review' | 'unknown';

export interface PhoneClassification {
  phone_e164: string | null;
  phone_valid: number;
  phone_line_type: string | null;
  phone_carrier: string | null;
  phone_route: PhoneRoute;
  phone_lookup_error: string | null;
}

interface TwilioLookupResponse {
  phone_number?: string | null;
  national_format?: string | null;
  valid?: boolean;
  validation_errors?: string[] | null;
  line_type_intelligence?: {
    type?: string | null;
    carrier_name?: string | null;
    error_code?: string | null;
  } | null;
}

export function routeForLineType(valid: boolean, lineType: string | null): PhoneRoute {
  if (!valid) return 'review';
  if (lineType === 'landline') return 'call';
  if (lineType === 'mobile' || lineType === 'fixedVoip' || lineType === 'nonFixedVoip') return 'text';
  return 'review';
}

function normalizeForLookup(raw: string | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('+')) return `+${trimmed.slice(1).replace(/\D/g, '')}`;
  const digits = trimmed.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return digits ? `+${digits}` : null;
}

export async function classifyPhoneNumber(env: Env, rawPhone: string | null): Promise<PhoneClassification> {
  const phone = normalizeForLookup(rawPhone);
  if (!phone) {
    return {
      phone_e164: null,
      phone_valid: 0,
      phone_line_type: null,
      phone_carrier: null,
      phone_route: 'review',
      phone_lookup_error: 'Missing phone number',
    };
  }

  if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN) {
    throw new Error('Twilio Lookup is not configured. Set TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN.');
  }

  const auth = btoa(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`);
  const url = `https://lookups.twilio.com/v2/PhoneNumbers/${encodeURIComponent(phone)}?Fields=line_type_intelligence`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Basic ${auth}`,
      Accept: 'application/json',
    },
  });
  const json = await res.json().catch(() => null) as (TwilioLookupResponse & { message?: string; code?: number }) | null;

  if (!res.ok) {
    const detail = json?.message || `Twilio Lookup failed with HTTP ${res.status}`;
    return {
      phone_e164: phone,
      phone_valid: 0,
      phone_line_type: null,
      phone_carrier: null,
      phone_route: 'review',
      phone_lookup_error: detail,
    };
  }

  const valid = json?.valid === true;
  const lineType = json?.line_type_intelligence?.type ?? null;
  const carrier = json?.line_type_intelligence?.carrier_name ?? null;
  const ltiError = json?.line_type_intelligence?.error_code
    ? `Line type error ${json.line_type_intelligence.error_code}`
    : null;
  const validationError = !valid && json?.validation_errors?.length
    ? json.validation_errors.join(', ')
    : null;

  return {
    phone_e164: json?.phone_number ?? phone,
    phone_valid: valid ? 1 : 0,
    phone_line_type: lineType,
    phone_carrier: carrier,
    phone_route: routeForLineType(valid, lineType),
    phone_lookup_error: ltiError ?? validationError,
  };
}
