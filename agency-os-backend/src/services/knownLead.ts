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

interface KnownLeadRow {
  id: number;
  place_id: string | null;
  phone: string | null;
  phone_e164: string | null;
  company: string;
  city: string | null;
  state: string | null;
}

// D1 accepts at most 100 bound parameters per statement. Leave a little room
// so future predicates can be added without taking this lookup back to the
// platform limit.
const MAX_QUERY_PARAMS = 90;

const normalizedPhoneSql = (column: string) =>
  `replace(replace(replace(replace(replace(replace(COALESCE(${column},''),'+',''),'(',''),')',''),'-',''),' ',''),'.','')`;

function phoneKey(value: string | null | undefined): string {
  const digits = (value ?? '').replace(/\D/g, '');
  return digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
}

function textKey(value: string | null | undefined): string {
  return (value ?? '').trim().toLocaleLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function chunksOf<T>(values: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) chunks.push(values.slice(index, index + size));
  return chunks;
}

async function selectKnownLeadRows(db: D1Database, inputs: LeadIdentityInput[]): Promise<KnownLeadRow[]> {
  const placeIds = [...new Set(inputs.map((value) => value.placeId).filter((value): value is string => Boolean(value)))];
  const phones = [...new Set(inputs.map((value) => phoneKey(value.phone)).filter((value) => value.length >= 7))];
  const sqlPhones = [...new Set(phones.flatMap((phone) => phone.length === 10 ? [phone, `1${phone}`] : [phone]))];
  const companyQueries = [...new Set(inputs.map((value) => (value.company ?? value.name ?? '').trim().toLocaleLowerCase()).filter(Boolean))];
  const rows = new Map<number, KnownLeadRow>();
  const select = 'SELECT id,place_id,phone,phone_e164,company,city,state FROM leads WHERE ';

  for (const chunk of chunksOf(placeIds, MAX_QUERY_PARAMS)) {
    const result = await db.prepare(`${select}place_id IN (${chunk.map(() => '?').join(',')})`)
      .bind(...chunk).all<KnownLeadRow>();
    result.results.forEach((row) => rows.set(row.id, row));
  }

  // Each phone is bound twice because both stored phone columns are checked.
  for (const chunk of chunksOf(sqlPhones, Math.floor(MAX_QUERY_PARAMS / 2))) {
    const placeholders = chunk.map(() => '?').join(',');
    const result = await db.prepare(
      `${select}(${normalizedPhoneSql('phone_e164')} IN (${placeholders}) OR ${normalizedPhoneSql('phone')} IN (${placeholders}))`,
    ).bind(...chunk, ...chunk).all<KnownLeadRow>();
    result.results.forEach((row) => rows.set(row.id, row));
  }

  for (const chunk of chunksOf(companyQueries, MAX_QUERY_PARAMS)) {
    const result = await db.prepare(`${select}lower(trim(company)) IN (${chunk.map(() => '?').join(',')})`)
      .bind(...chunk).all<KnownLeadRow>();
    result.results.forEach((row) => rows.set(row.id, row));
  }

  return [...rows.values()];
}

/** Match every historical lead, including archived/deleted rows. */
export async function findKnownLeads(db: D1Database, inputs: LeadIdentityInput[]): Promise<Map<number, KnownLeadMatch>> {
  const matches = new Map<number, KnownLeadMatch>();
  if (!inputs.length) return matches;
  const rows = await selectKnownLeadRows(db, inputs);
  inputs.forEach((input, index) => {
    const byPlace = input.placeId && rows.find((row) => row.place_id === input.placeId);
    if (byPlace) { matches.set(index, { leadId: byPlace.id, reason: 'place_id' }); return; }
    const phone = phoneKey(input.phone);
    const byPhone = phone.length >= 7 && rows.find((row) => phoneKey(row.phone_e164 || row.phone) === phone);
    if (byPhone) { matches.set(index, { leadId: byPhone.id, reason: 'phone' }); return; }
    const company = textKey(input.company ?? input.name);
    const city = textKey(input.city);
    const state = textKey(input.state);
    const byLocation = company && city && rows.find((row) => textKey(row.company) === company && textKey(row.city) === city && (!state || textKey(row.state) === state));
    if (byLocation) matches.set(index, { leadId: byLocation.id, reason: 'company_location' });
  });
  return matches;
}
