import { Hono } from 'hono';
import type { Env } from '../types';
import { badRequest, conflict, notFound, serverError, log } from '../utils/errors';

export const leadsRouter = new Hono<{ Bindings: Env }>();

const LEAD_FIELDS = [
  'company', 'contact', 'phone', 'email', 'industry', 'city', 'state', 'address',
  'place_id', 'gbp_claimed', 'gbp_completeness', 'gbp_photos_count', 'gbp_categories',
  'gbp_hours', 'google_rating', 'google_review_count', 'google_reviews', 'reviews_fetched_at',
  'website', 'has_website', 'pagespeed_desktop', 'pagespeed_mobile',
  'extracted_services', 'extracted_service_areas', 'extracted_strengths',
  'pitch_quotes', 'owner_names', 'opportunity_score', 'recommended_tier',
  'enrichment_status', 'enrichment_error', 'status', 'outcome', 'followup',
  'notes', 'source', 'project_id',
];

leadsRouter.get('/', async (c) => {
  try {
    const { status, tier, enrichment, search } = c.req.query();
    let query = 'SELECT * FROM leads WHERE 1=1';
    const params: unknown[] = [];

    if (status) { query += ' AND status = ?'; params.push(status); }
    if (tier) { query += ' AND recommended_tier = ?'; params.push(parseInt(tier, 10)); }
    if (enrichment) { query += ' AND enrichment_status = ?'; params.push(enrichment); }
    if (search) {
      query += ' AND (company LIKE ? OR contact LIKE ? OR phone LIKE ? OR city LIKE ?)';
      const like = `%${search}%`;
      params.push(like, like, like, like);
    }

    query += ' ORDER BY updated_at DESC LIMIT 500';
    const result = await c.env.DB.prepare(query).bind(...params).all();
    return c.json({ leads: result.results, total: result.results.length });
  } catch (err) {
    log('error', 'leads', 'GET /leads failed', err);
    return c.json(serverError(), 500);
  }
});

leadsRouter.get('/export', async (c) => {
  try {
    const result = await c.env.DB.prepare('SELECT * FROM leads ORDER BY company ASC').all();
    const leads = result.results as Record<string, unknown>[];

    if (leads.length === 0) return c.text('', 200, { 'Content-Type': 'text/csv' });

    const headers = Object.keys(leads[0]).join(',');
    const rows = leads.map(l =>
      Object.values(l).map(v => (v === null ? '' : `"${String(v).replace(/"/g, '""')}"`)).join(',')
    );
    const csv = [headers, ...rows].join('\n');

    return c.text(csv, 200, {
      'Content-Type': 'text/csv',
      'Content-Disposition': 'attachment; filename="leads-export.csv"',
    });
  } catch (err) {
    log('error', 'leads', 'GET /leads/export failed', err);
    return c.json(serverError(), 500);
  }
});

leadsRouter.get('/:id', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) return c.json(badRequest('Invalid lead ID'), 400);

  const lead = await c.env.DB.prepare('SELECT * FROM leads WHERE id = ?').bind(id).first();
  if (!lead) return c.json(notFound('Lead'), 404);

  const calls = await c.env.DB
    .prepare('SELECT * FROM call_log WHERE lead_id = ? ORDER BY created_at DESC')
    .bind(id)
    .all();

  return c.json({ lead, calls: calls.results });
});

leadsRouter.post('/', async (c) => {
  try {
    const body = await c.req.json() as Record<string, unknown>;
    const company = body.company as string | undefined;
    const phone = body.phone as string | undefined;

    if (!company) return c.json(badRequest('company is required'), 400);

    const existing = await c.env.DB
      .prepare("SELECT id FROM leads WHERE company = ? AND COALESCE(phone, '') = ?")
      .bind(company, phone ?? '')
      .first();

    if (existing) return c.json(conflict('Lead already exists with this company + phone'), 409);

    const insertCols: string[] = [];
    const insertVals: unknown[] = [];
    for (const field of LEAD_FIELDS) {
      if (field in body) {
        insertCols.push(field);
        let v: unknown = body[field];
        if (field === 'has_website' || field === 'gbp_claimed') v = v ? 1 : 0;
        insertVals.push(v ?? null);
      }
    }
    if (!insertCols.includes('company')) {
      insertCols.push('company');
      insertVals.push(company);
    }
    if (!insertCols.includes('source')) {
      insertCols.push('source');
      insertVals.push('add-lead');
    }

    const placeholders = insertCols.map(() => '?').join(', ');
    const stmt = c.env.DB.prepare(
      `INSERT INTO leads (${insertCols.join(', ')}) VALUES (${placeholders})`
    ).bind(...insertVals);

    const result = await stmt.run();
    const newLead = await c.env.DB
      .prepare('SELECT * FROM leads WHERE id = ?')
      .bind(result.meta.last_row_id)
      .first();

    return c.json({ lead: newLead }, 201);
  } catch (err) {
    log('error', 'leads', 'POST /leads failed', err);
    return c.json(serverError(), 500);
  }
});

leadsRouter.put('/:id', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) return c.json(badRequest('Invalid lead ID'), 400);

  const existing = await c.env.DB.prepare('SELECT id FROM leads WHERE id = ?').bind(id).first();
  if (!existing) return c.json(notFound('Lead'), 404);

  try {
    const body = await c.req.json() as Record<string, unknown>;

    const updates = Object.entries(body)
      .filter(([k]) => LEAD_FIELDS.includes(k))
      .map(([k, v]) => {
        let val = v;
        if (k === 'has_website' || k === 'gbp_claimed') val = val ? 1 : 0;
        return { key: k, value: val ?? null };
      });

    if (updates.length === 0) return c.json(badRequest('No valid fields to update'), 400);

    const setClause = [...updates.map(u => `${u.key} = ?`), "updated_at = datetime('now')"].join(', ');
    const values = [...updates.map(u => u.value), id];

    await c.env.DB.prepare(`UPDATE leads SET ${setClause} WHERE id = ?`).bind(...values).run();

    const updated = await c.env.DB.prepare('SELECT * FROM leads WHERE id = ?').bind(id).first();
    return c.json({ lead: updated });
  } catch (err) {
    log('error', 'leads', `PUT /leads/${id} failed`, err);
    return c.json(serverError(), 500);
  }
});

leadsRouter.delete('/:id', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) return c.json(badRequest('Invalid lead ID'), 400);

  const existing = await c.env.DB.prepare('SELECT id FROM leads WHERE id = ?').bind(id).first();
  if (!existing) return c.json(notFound('Lead'), 404);

  await c.env.DB
    .prepare("UPDATE leads SET status = 'dead', updated_at = datetime('now') WHERE id = ?")
    .bind(id)
    .run();
  log('info', 'leads', `Lead ${id} marked dead`);
  return c.json({ success: true });
});

// CSV import — header-based parser, dedupes by company+phone or place_id
leadsRouter.post('/import', async (c) => {
  try {
    const contentType = c.req.header('content-type') ?? '';
    let rows: Record<string, string>[] = [];

    if (contentType.includes('multipart/form-data') || contentType.includes('application/x-www-form-urlencoded')) {
      const form = await c.req.formData();
      const file = form.get('file');
      if (!file || typeof file === 'string') return c.json(badRequest('file field required'), 400);
      const text = await (file as File).text();
      rows = parseCsv(text);
    } else {
      const body = await c.req.text();
      rows = parseCsv(body);
    }

    if (rows.length === 0) return c.json(badRequest('CSV has no data rows'), 400);

    let imported = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const row of rows) {
      if (!row.company) { skipped++; continue; }

      const dupe = await c.env.DB
        .prepare("SELECT id FROM leads WHERE place_id = ? OR (company = ? AND COALESCE(phone, '') = ?)")
        .bind(row.place_id || null, row.company, row.phone || '')
        .first();

      if (dupe) { skipped++; continue; }

      try {
        await c.env.DB.prepare(
          `INSERT INTO leads (company, contact, phone, email, industry, city, state, address,
                              place_id, website, has_website, notes, source, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'csv-import', 'cold')`
        ).bind(
          row.company,
          row.contact || null,
          row.phone || null,
          row.email || null,
          row.industry || null,
          row.city || null,
          row.state || null,
          row.address || null,
          row.place_id || null,
          row.website || null,
          row.website ? 1 : 0,
          row.notes || null,
        ).run();
        imported++;
      } catch (err) {
        skipped++;
        errors.push(`${row.company}: ${(err as Error).message}`);
      }
    }

    return c.json({ imported, skipped, errors: errors.slice(0, 10) });
  } catch (err) {
    log('error', 'leads', 'POST /leads/import failed', err);
    return c.json(serverError(), 500);
  }
});

function parseCsv(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return [];
  const headers = parseLine(lines[0]).map(h => h.trim().toLowerCase());
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const values = parseLine(lines[i]);
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => { row[h] = (values[idx] ?? '').trim(); });
    rows.push(row);
  }
  return rows;
}

function parseLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { cur += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}
