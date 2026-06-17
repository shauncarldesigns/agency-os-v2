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
    const recordingUrl = (body.recording_url ?? body.recordingUrl) as string | null | undefined;
    const recordingCallIdRaw = body.recording_call_id ?? body.recordingCallId;
    const recordingCallId = typeof recordingCallIdRaw === 'number' ? recordingCallIdRaw : null;

    if (!outcome) return c.json(badRequest('outcome is required'), 400);
    if (!notes) return c.json(badRequest('notes is required'), 400);

    let result: { meta: { last_row_id: number } };
    if (recordingCallId) {
      await c.env.DB
        .prepare(`UPDATE call_log
                     SET outcome = ?, notes = ?, followup_date = ?, objection_hits = ?,
                         recording_url = COALESCE(?, recording_url)
                   WHERE id = ? AND lead_id = ?`)
        .bind(outcome, notes, followupDate ?? null, objectionHits, recordingUrl ?? null, recordingCallId, leadId)
        .run();
      result = { meta: { last_row_id: recordingCallId } };
    } else {
      result = await c.env.DB
        .prepare('INSERT INTO call_log (lead_id, outcome, notes, followup_date, objection_hits, recording_url) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(leadId, outcome, notes, followupDate ?? null, objectionHits, recordingUrl ?? null)
        .run();
    }

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

// ============================================================================
// RECORDING RECOVERY — list R2 objects for a lead + attach orphans to call_log
// ----------------------------------------------------------------------------
// Safety net for any recording that uploaded successfully but never got a
// call_log row (e.g. operator navigated away pre-fix-86 before tapping an
// outcome). Lists every R2 key under calls/{leadId}/ and marks which are
// already referenced by a call_log row. Frontend offers an "attach" action
// for orphans.
// ============================================================================

const PUBLIC_BASE_DEFAULT = 'https://pub-80e0811bf1bd472a8ff972eb94b314e0.r2.dev';

leadCallsRouter.get('/:id/recordings', async (c) => {
  const leadId = parseInt(c.req.param('id'), 10);
  if (isNaN(leadId)) return c.json(badRequest('Invalid lead ID'), 400);

  const lead = await c.env.DB.prepare('SELECT id FROM leads WHERE id = ?').bind(leadId).first();
  if (!lead) return c.json(notFound('Lead'), 404);

  const base = c.env.RECORDINGS_PUBLIC_URL || PUBLIC_BASE_DEFAULT;

  // List R2 objects under this lead's prefix.
  const listed = await c.env.RECORDINGS.list({ prefix: `calls/${leadId}/` });

  // Fetch all call_log rows for this lead that already point at recordings.
  // Build a set of URLs for fast attach-status lookup.
  const callsWithRecording = await c.env.DB
    .prepare(`SELECT id, recording_url FROM call_log WHERE lead_id = ? AND recording_url IS NOT NULL`)
    .bind(leadId)
    .all<{ id: number; recording_url: string }>();
  const attachedByUrl = new Map<string, number>();
  for (const row of (callsWithRecording.results ?? [])) {
    attachedByUrl.set(row.recording_url, row.id);
  }

  const recordings = listed.objects.map((obj) => {
    const url = `${base}/${obj.key}`;
    const callId = attachedByUrl.get(url) ?? null;
    return {
      key: obj.key,
      url,
      size_bytes: obj.size,
      uploaded_at: obj.uploaded,
      attached: callId !== null,
      call_id: callId,
    };
  });

  // Sort newest first.
  recordings.sort((a, b) => new Date(b.uploaded_at).getTime() - new Date(a.uploaded_at).getTime());

  return c.json({ recordings });
});

leadCallsRouter.post('/:id/recordings/attach', async (c) => {
  const leadId = parseInt(c.req.param('id'), 10);
  if (isNaN(leadId)) return c.json(badRequest('Invalid lead ID'), 400);

  const body = await c.req.json().catch(() => ({})) as { url?: string };
  if (!body.url) return c.json(badRequest('url is required'), 400);

  const lead = await c.env.DB.prepare('SELECT id FROM leads WHERE id = ?').bind(leadId).first();
  if (!lead) return c.json(notFound('Lead'), 404);

  // Idempotent — if a call_log row already holds this URL, return that row.
  const existing = await c.env.DB
    .prepare(`SELECT id FROM call_log WHERE lead_id = ? AND recording_url = ? LIMIT 1`)
    .bind(leadId, body.url)
    .first<{ id: number }>();
  if (existing) return c.json({ call_id: existing.id, created: false });

  const result = await c.env.DB
    .prepare(`INSERT INTO call_log (lead_id, outcome, notes, recording_url) VALUES (?, 'Recording', ?, ?)`)
    .bind(leadId, '(orphan recording re-attached from R2)', body.url)
    .run();

  return c.json({ call_id: result.meta.last_row_id, created: true });
});
