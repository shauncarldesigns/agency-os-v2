import type { D1Database } from '@cloudflare/workers-types';

export interface LeadIdentityInput {
  placeId?: string | null;
  phone?: string | null;
  company?: string | null;
  name?: string | null;
  city?: string | null;
  state?: string | null;
}

export interface KnownLeadMatch {
  leadId: number;
  reason: 'place_id' | 'phone' | 'company_location';
}

const normalizedPhoneSql = (column: string) =>
  `replace(replace(replace(replace(replace(replace(COALESCE(${column},''),'+',''),'(',''),')',''),'-',''),' ',''),'.','')`;

function phoneKey(value: string | null | undefined): string {
  const digits = (value ?? '').replace(/\D/g, '');
  return digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
}

function textKey(value: string | null | undefined): string {
  return (value ?? '').trim().toLocaleLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/** Match every historical lead, including archived/deleted rows. */
export async function findKnownLeads(db: D1Database, inputs: LeadIdentityInput[]): Promise<Map<number, KnownLeadMatch>> {
  const matches = new Map<number, KnownLeadMatch>();
  if (!inputs.length) return matches;
  const placeIds = [...new Set(inputs.map((v) => v.placeId).filter((v): v is string => Boolean(v)))];
  const phones = [...new Set(inputs.map((v) => phoneKey(v.phone)).filter((v) => v.length >= 7))];
  const sqlPhones = [...new Set(phones.flatMap((phone) => phone.length === 10 ? [phone, `1${phone}`] : [phone]))];
  const companyQueries = [...new Set(inputs.map((v) => (v.company ?? v.name ?? '').trim().toLocaleLowerCase()).filter(Boolean))];
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (placeIds.length) { clauses.push(`place_id IN (${placeIds.map(() => '?').join(',')})`); params.push(...placeIds); }
  if (sqlPhones.length) {
    clauses.push(`(${normalizedPhoneSql('phone_e164')} IN (${sqlPhones.map(() => '?').join(',')}) OR ${normalizedPhoneSql('phone')} IN (${sqlPhones.map(() => '?').join(',')}))`);
    params.push(...sqlPhones, ...sqlPhones);
  }
  if (companyQueries.length) { clauses.push(`lower(trim(company)) IN (${companyQueries.map(() => '?').join(',')})`); params.push(...companyQueries); }
  if (!clauses.length) return matches;
  const rows = await db.prepare(`SELECT id,place_id,phone,phone_e164,company,city,state FROM leads WHERE ${clauses.join(' OR ')}`)
    .bind(...params).all<{ id: number; place_id: string | null; phone: string | null; phone_e164: string | null; company: string; city: string | null; state: string | null }>();
  inputs.forEach((input, index) => {
    const byPlace = input.placeId && rows.results.find((row) => row.place_id === input.placeId);
    if (byPlace) { matches.set(index, { leadId: byPlace.id, reason: 'place_id' }); return; }
    const phone = phoneKey(input.phone);
    const byPhone = phone.length >= 7 && rows.results.find((row) => phoneKey(row.phone_e164 || row.phone) === phone);
    if (byPhone) { matches.set(index, { leadId: byPhone.id, reason: 'phone' }); return; }
    const company = textKey(input.company ?? input.name);
    const city = textKey(input.city);
    const state = textKey(input.state);
    const byLocation = company && city && rows.results.find((row) => textKey(row.company) === company && textKey(row.city) === city && (!state || textKey(row.state) === state));
    if (byLocation) matches.set(index, { leadId: byLocation.id, reason: 'company_location' });
  });
  return matches;
}
