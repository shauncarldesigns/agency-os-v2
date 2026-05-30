import { Hono } from 'hono';
import type { Env, Lead } from '../types';
import { badRequest, conflict, notFound, serverError, log } from '../utils/errors';
import { generateProjectSlug } from '../utils/slug';

export const leadsRouter = new Hono<{ Bindings: Env }>();

const LEAD_FIELDS = [
  'company', 'contact', 'phone', 'email', 'industry', 'city', 'state', 'address',
  'place_id', 'gbp_claimed', 'gbp_completeness', 'gbp_photos_count', 'gbp_categories',
  'gbp_hours', 'google_rating', 'google_review_count', 'google_reviews', 'reviews_fetched_at',
  'website', 'has_website', 'pagespeed_desktop', 'pagespeed_mobile',
  'extracted_services', 'extracted_service_areas', 'extracted_strengths',
  'pitch_quotes', 'owner_names', 'opportunity_score', 'opportunity_reasoning', 'recommended_tier',
  'enrichment_status', 'enrichment_error', 'status', 'outcome', 'followup',
  'notes', 'source', 'project_id',
];

leadsRouter.get('/', async (c) => {
  try {
    const { status, tier, enrichment, search, industry, include_deleted, only_deleted } = c.req.query();
    let query = 'SELECT * FROM leads WHERE 1=1';
    const params: unknown[] = [];

    // Soft-delete handling: default to active rows. `only_deleted=true` flips
    // to the trash view; `include_deleted=true` shows both.
    if (only_deleted === 'true' || only_deleted === '1') {
      query += ' AND deleted_at IS NOT NULL';
    } else if (include_deleted !== 'true' && include_deleted !== '1') {
      query += ' AND deleted_at IS NULL';
    }

    if (status) { query += ' AND status = ?'; params.push(status); }
    if (tier) { query += ' AND recommended_tier = ?'; params.push(parseInt(tier, 10)); }
    if (enrichment) { query += ' AND enrichment_status = ?'; params.push(enrichment); }
    if (industry) { query += ' AND industry = ?'; params.push(industry); }
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

// GET /api/leads/industries — distinct industry values (for filter dropdown)
leadsRouter.get('/industries', async (c) => {
  try {
    const result = await c.env.DB
      .prepare("SELECT DISTINCT industry FROM leads WHERE industry IS NOT NULL AND industry != '' AND deleted_at IS NULL ORDER BY industry ASC")
      .all<{ industry: string }>();
    return c.json({ industries: (result.results ?? []).map((r) => r.industry) });
  } catch (err) {
    log('error', 'leads', 'GET /leads/industries failed', err);
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

  const existing = await c.env.DB.prepare('SELECT * FROM leads WHERE id = ?').bind(id).first<Lead>();
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

    // NOTE: Auto-project-on-client was removed in the qualify-flow refactor.
    // Conversion now happens explicitly via POST /api/leads/:id/qualify, which
    // captures the operator-chosen tier rather than guessing from recommended_tier.

    const updated = await c.env.DB.prepare('SELECT * FROM leads WHERE id = ?').bind(id).first();
    return c.json({ lead: updated });
  } catch (err) {
    log('error', 'leads', `PUT /leads/${id} failed`, err);
    return c.json(serverError(), 500);
  }
});

// POST /api/leads/:id/qualify
// The operator-driven qualification step: pick a tier, optionally drop a note,
// and convert the lead into a Sites project in one round-trip. Replaces the
// implicit "auto-create project when status=client" flow and the legacy
// homepage-demo path.
leadsRouter.post('/:id/qualify', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) return c.json(badRequest('Invalid lead ID'), 400);

  const lead = await c.env.DB.prepare('SELECT * FROM leads WHERE id = ?').bind(id).first<Lead>();
  if (!lead) return c.json(notFound('Lead'), 404);
  if (lead.project_id) return c.json(conflict('Lead already has a project — open it in Sites'), 409);
  if (lead.enrichment_status !== 'enriched') {
    return c.json(badRequest('Lead must be enriched before qualifying'), 400);
  }

  let body: Record<string, unknown> = {};
  try {
    body = await c.req.json();
  } catch {
    // Body is optional — defaults to recommended_tier
  }

  const tierRaw = body.tier ?? lead.recommended_tier ?? 1;
  const tier = Number(tierRaw) as 1 | 2 | 3;
  if (![1, 2, 3].includes(tier)) return c.json(badRequest('tier must be 1, 2, or 3'), 400);

  const note = typeof body.note === 'string' && body.note.trim() ? body.note.trim() : null;

  try {
    const projectId = await createProjectFromLead(c.env, lead, tier);

    // Mark the lead as a client + link the project. Stamp the note onto the
    // lead's notes field (prepended) so the qualification reason isn't lost.
    const stamp = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const newNotes = note
      ? [`[${stamp} · Qualified Tier ${tier}] ${note}`, lead.notes].filter(Boolean).join('\n\n')
      : lead.notes;

    await c.env.DB.prepare(
      "UPDATE leads SET status = 'client', project_id = ?, notes = ?, updated_at = datetime('now') WHERE id = ?"
    ).bind(projectId, newNotes, id).run();

    const [updatedLead, project] = await Promise.all([
      c.env.DB.prepare('SELECT * FROM leads WHERE id = ?').bind(id).first(),
      c.env.DB.prepare('SELECT * FROM projects WHERE id = ?').bind(projectId).first(),
    ]);

    log('info', 'leads', `Lead ${id} qualified → project ${projectId} (T${tier})`);
    return c.json({ lead: updatedLead, project }, 201);
  } catch (err) {
    log('error', 'leads', `POST /leads/${id}/qualify failed`, err);
    return c.json(serverError(`Qualify failed: ${(err as Error).message}`), 500);
  }
});

/**
 * Insert a project row from an existing enriched lead. Used by the qualify
 * endpoint above; also re-exportable if other flows need it later.
 */
async function createProjectFromLead(env: Env, lead: Lead, tier: 1 | 2 | 3): Promise<number> {
  const slug = generateProjectSlug(lead.company, lead.city ?? '', lead.state ?? 'WI');
  const now = new Date();
  const contractStart = tier === 3 ? now.toISOString() : null;
  const contractMinEnd = tier === 3
    ? new Date(now.getFullYear(), now.getMonth() + 6, now.getDate()).toISOString()
    : null;
  const pagesPlanned = tier === 3 ? 15 : 5;

  const insert = await env.DB.prepare(`
    INSERT INTO projects (
      lead_id, name, slug, tier, business_name, industry, city, state, phone, email,
      services, service_areas, pages_planned,
      contract_start, contract_min_end, merchynt_active, status, reviews_snapshot
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'building', ?)
  `).bind(
    lead.id,
    lead.company,
    slug,
    tier,
    lead.company,
    lead.industry ?? null,
    lead.city ?? 'Unknown',
    lead.state ?? 'WI',
    lead.phone ?? null,
    lead.email ?? null,
    lead.extracted_services ?? null,
    lead.extracted_service_areas ?? null,
    pagesPlanned,
    contractStart,
    contractMinEnd,
    tier === 3 ? 1 : 0,
    lead.google_reviews ?? null,
  ).run();

  return insert.meta.last_row_id as number;
}

// Soft delete — sets deleted_at. Use POST /:id/restore to undo, or pass
// ?hard=true for a permanent delete (only allowed when the lead is already
// soft-deleted, to avoid accidental destruction).
leadsRouter.delete('/:id', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) return c.json(badRequest('Invalid lead ID'), 400);
  const hard = c.req.query('hard') === 'true';

  const existing = await c.env.DB.prepare('SELECT id, deleted_at FROM leads WHERE id = ?').bind(id).first<{ id: number; deleted_at: string | null }>();
  if (!existing) return c.json(notFound('Lead'), 404);

  if (hard) {
    if (!existing.deleted_at) {
      return c.json(badRequest('Soft-delete the lead first before permanent deletion'), 400);
    }
    await c.env.DB.prepare('DELETE FROM leads WHERE id = ?').bind(id).run();
    log('info', 'leads', `Lead ${id} hard-deleted`);
    return c.body(null, 204);
  }

  await c.env.DB
    .prepare("UPDATE leads SET deleted_at = datetime('now'), updated_at = datetime('now') WHERE id = ?")
    .bind(id)
    .run();
  log('info', 'leads', `Lead ${id} soft-deleted`);
  return c.body(null, 204);
});

leadsRouter.post('/:id/restore', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) return c.json(badRequest('Invalid lead ID'), 400);

  const existing = await c.env.DB.prepare('SELECT id FROM leads WHERE id = ?').bind(id).first();
  if (!existing) return c.json(notFound('Lead'), 404);

  await c.env.DB
    .prepare("UPDATE leads SET deleted_at = NULL, updated_at = datetime('now') WHERE id = ?")
    .bind(id)
    .run();
  log('info', 'leads', `Lead ${id} restored`);
  const lead = await c.env.DB.prepare('SELECT * FROM leads WHERE id = ?').bind(id).first();
  return c.json({ lead });
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
