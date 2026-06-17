import { Hono } from 'hono';
import type { Env } from '../types';
import { badRequest, notFound, serverError, log } from '../utils/errors';

// Mounted at /api/leads — handles /:id/calls (list, create) and at /api/calls — handles /:id (delete)
export const leadCallsRouter = new Hono<{ Bindings: Env }>();
export const callsRouter = new Hono<{ Bindings: Env }>();

leadCallsRouter.get('/:id/calls', async (c) => {
  const leadId = parseInt(c.req.param('id'), 10);
  if (isNaN(leadId)) return c.json(badRequest('Invalid lead ID'), 400);

  const lead = await c.env.DB.prepare('SELECT id FROM leads WHERE id = ?').bind(leadId).first();
  if (!lead) return c.json(notFound('Lead'), 404);

  const result = await c.env.DB
    .prepare('SELECT * FROM call_log WHERE lead_id = ? ORDER BY created_at DESC')
    .bind(leadId)
    .all();
  return c.json({ calls: result.results });
});

leadCallsRouter.post('/:id/calls', async (c) => {
  const leadId = parseInt(c.req.param('id'), 10);
  if (isNaN(leadId)) return c.json(badRequest('Invalid lead ID'), 400);

  const lead = await c.env.DB.prepare('SELECT id FROM leads WHERE id = ?').bind(leadId).first();
  if (!lead) return c.json(notFound('Lead'), 404);

  try {
    const body = await c.req.json() as Record<string, unknown>;
    const outcome = body.outcome as string | undefined;
    const notes = body.notes as string | undefined;
    const followupDate = (body.followup_date ?? body.followupDate) as string | undefined;
    // Playbook objection-hit log (Phase 4a). Accepts an array; stored as JSON.
    const objectionHitsRaw = body.objection_hits ?? body.objectionHits;
    const objectionHits = Array.isArray(objectionHitsRaw) && objectionHitsRaw.length
      ? JSON.stringify(objectionHitsRaw)
      : null;

    if (!outcome) return c.json(badRequest('outcome is required'), 400);
    if (!notes) return c.json(badRequest('notes is required'), 400);

    const result = await c.env.DB
      .prepare('INSERT INTO call_log (lead_id, outcome, notes, followup_date, objection_hits) VALUES (?, ?, ?, ?, ?)')
      .bind(leadId, outcome, notes, followupDate ?? null, objectionHits)
      .run();

    // Update lead's last outcome + followup
    await c.env.DB
      .prepare(`UPDATE leads SET outcome = ?, followup = ?,
                status = CASE WHEN status = 'cold' THEN 'contacted' ELSE status END,
                updated_at = datetime('now') WHERE id = ?`)
      .bind(outcome, followupDate ?? null, leadId)
      .run();

    const newCall = await c.env.DB
      .prepare('SELECT * FROM call_log WHERE id = ?')
      .bind(result.meta.last_row_id)
      .first();

    return c.json({ call: newCall }, 201);
  } catch (err) {
    log('error', 'calls', `POST /leads/${leadId}/calls failed`, err);
    return c.json(serverError(), 500);
  }
});

callsRouter.delete('/:id', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) return c.json(badRequest('Invalid call ID'), 400);

  const existing = await c.env.DB.prepare('SELECT id FROM call_log WHERE id = ?').bind(id).first();
  if (!existing) return c.json(notFound('Call'), 404);

  await c.env.DB.prepare('DELETE FROM call_log WHERE id = ?').bind(id).run();
  return c.json({ success: true });
});
