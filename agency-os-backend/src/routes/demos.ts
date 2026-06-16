// Demos — booked-demo lifecycle.
//
// Demos are normally created via the session outcome endpoint; this router
// exposes the read + lifecycle endpoints for the priority strip (awaiting
// status, no-show recovery) and the Mark-as-Held/No-show/Rescheduled flow.

import { Hono } from 'hono';
import type { Env, Demo, DemoStatus } from '../types';
import { badRequest, notFound, log } from '../utils/errors';
import { chicagoToday } from '../services/dayOfWeek';

export const demosRouter = new Hono<{ Bindings: Env }>();

// GET /api/demos?status=&date=
demosRouter.get('/', async (c) => {
  const status = c.req.query('status') ?? '';
  const date = c.req.query('date') ?? '';
  const clauses: string[] = ['1 = 1'];
  const params: unknown[] = [];
  if (status) { clauses.push('status = ?'); params.push(status); }
  if (date) { clauses.push("date(scheduled_for) = ?"); params.push(date); }
  const sql = `
    SELECT d.*, l.company, l.phone, l.city, l.state, l.contact
    FROM demos d
    INNER JOIN leads l ON l.id = d.lead_id
    WHERE ${clauses.join(' AND ')}
    ORDER BY scheduled_for ASC
  `;
  const result = await c.env.DB.prepare(sql).bind(...params).all();
  return c.json({ demos: result.results ?? [] });
});

// GET /api/demos/awaiting-status — scheduled_for < today AND status='booked'
// "past-today" semantics per Phase 0 decision: a demo at 9am today doesn't
// show as awaiting until TOMORROW. Operator marks held/no-show/rescheduled
// the day after.
demosRouter.get('/awaiting-status', async (c) => {
  const today = chicagoToday();
  const result = await c.env.DB.prepare(`
    SELECT d.*, l.company, l.phone, l.city, l.state, l.contact
    FROM demos d
    INNER JOIN leads l ON l.id = d.lead_id
    WHERE d.status = 'booked' AND date(d.scheduled_for) < ?
    ORDER BY d.scheduled_for ASC
  `).bind(today).all();
  return c.json({ demos: result.results ?? [] });
});

// GET /api/demos/no-show-recovery — status='no_show' AND no follow-up call
// since the no_show status was set. Surfaces in priority strip.
demosRouter.get('/no-show-recovery', async (c) => {
  const result = await c.env.DB.prepare(`
    SELECT d.*, l.company, l.phone, l.city, l.state, l.contact
    FROM demos d
    INNER JOIN leads l ON l.id = d.lead_id
    WHERE d.status = 'no_show'
      AND (l.last_called_at IS NULL OR l.last_called_at < d.status_set_at)
    ORDER BY d.status_set_at DESC NULLS LAST, d.scheduled_for DESC
  `).all();
  return c.json({ demos: result.results ?? [] });
});

// GET /api/demos/today — informational, scheduled today, status='booked'
demosRouter.get('/today', async (c) => {
  const today = chicagoToday();
  const result = await c.env.DB.prepare(`
    SELECT d.*, l.company, l.phone, l.city, l.state, l.contact
    FROM demos d
    INNER JOIN leads l ON l.id = d.lead_id
    WHERE d.status = 'booked' AND date(d.scheduled_for) = ?
    ORDER BY d.scheduled_for ASC
  `).bind(today).all();
  return c.json({ demos: result.results ?? [] });
});

// PUT /api/demos/:id/status — body { status, newDate?, notes? }
demosRouter.put('/:id/status', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) return c.json(badRequest('Invalid demo ID'), 400);

  const demo = await c.env.DB.prepare('SELECT * FROM demos WHERE id = ?').bind(id).first<Demo>();
  if (!demo) return c.json(notFound('Demo'), 404);

  const body = (await c.req.json().catch(() => ({}))) as {
    status?: DemoStatus; newDate?: string; notes?: string;
  };
  const VALID: DemoStatus[] = ['booked', 'held', 'no_show', 'rescheduled'];
  if (!body.status || !VALID.includes(body.status)) {
    return c.json(badRequest(`Invalid status; expected one of ${VALID.join(',')}`), 400);
  }

  // Reschedule branch: updates scheduled_for too, flips status back to 'booked'
  // for the new date. Records the old date in the audit event.
  if (body.status === 'rescheduled') {
    if (!body.newDate) return c.json(badRequest('rescheduled requires newDate'), 400);
    await c.env.DB.prepare(`
      UPDATE demos
      SET status = 'booked', scheduled_for = ?, status_set_at = datetime('now'),
          outcome_notes = COALESCE(outcome_notes, '') || ? WHERE id = ?
    `).bind(body.newDate, body.notes ? `\n${body.notes}` : '', id).run();
    await c.env.DB.prepare(
      `INSERT INTO demo_events (demo_id, event_type, event_data) VALUES (?, 'rescheduled', ?)`
    ).bind(id, JSON.stringify({ from: demo.scheduled_for, to: body.newDate, notes: body.notes })).run();
    // Update lead's quick-reference pointer too.
    await c.env.DB.prepare(
      `UPDATE leads SET demo_scheduled_for = ?, updated_at = datetime('now') WHERE id = ?`
    ).bind(body.newDate, demo.lead_id).run();
  } else {
    await c.env.DB.prepare(`
      UPDATE demos SET status = ?, status_set_at = datetime('now'),
        outcome_notes = COALESCE(outcome_notes, '') || ? WHERE id = ?
    `).bind(body.status, body.notes ? `\n${body.notes}` : '', id).run();
    await c.env.DB.prepare(
      `INSERT INTO demo_events (demo_id, event_type, event_data) VALUES (?, ?, ?)`
    ).bind(id, body.status, body.notes ? JSON.stringify({ notes: body.notes }) : null).run();
  }

  log('info', 'demos', `Demo ${id} → ${body.status}`, { newDate: body.newDate });
  const updated = await c.env.DB.prepare('SELECT * FROM demos WHERE id = ?').bind(id).first<Demo>();
  return c.json({ demo: updated });
});
