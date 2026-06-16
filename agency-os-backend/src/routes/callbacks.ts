// Callbacks — day-precision callback tracking.
//
// Callbacks are normally created via POST /api/sessions/:id/outcome with
// outcome='callback'; this router exposes the read + mark-completed endpoints
// for the priority strip and Friday recovery list.

import { Hono } from 'hono';
import type { Env, Callback, CallbackStatus } from '../types';
import { badRequest, notFound, log } from '../utils/errors';

export const callbacksRouter = new Hono<{ Bindings: Env }>();

// GET /api/callbacks?status=&date=
callbacksRouter.get('/', async (c) => {
  const status = c.req.query('status') ?? '';
  const date = c.req.query('date') ?? '';
  const clauses: string[] = ['1 = 1'];
  const params: unknown[] = [];
  if (status) { clauses.push('status = ?'); params.push(status); }
  if (date) { clauses.push('due_date = ?'); params.push(date); }
  const sql = `SELECT * FROM callbacks WHERE ${clauses.join(' AND ')} ORDER BY due_date ASC, id ASC`;
  const result = await c.env.DB.prepare(sql).bind(...params).all<Callback>();
  return c.json({ callbacks: result.results ?? [] });
});

// PUT /api/callbacks/:id — update status (mark completed/missed) or due_date
callbacksRouter.put('/:id', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) return c.json(badRequest('Invalid callback ID'), 400);
  const existing = await c.env.DB.prepare('SELECT id FROM callbacks WHERE id = ?').bind(id).first();
  if (!existing) return c.json(notFound('Callback'), 404);

  const body = (await c.req.json().catch(() => ({}))) as { status?: CallbackStatus; due_date?: string; notes?: string };
  const sets: string[] = [];
  const params: unknown[] = [];
  if (body.status) { sets.push('status = ?'); params.push(body.status); }
  if (body.status === 'completed') { sets.push('completed_at = datetime(\'now\')'); }
  if (body.due_date) { sets.push('due_date = ?'); params.push(body.due_date); }
  if (typeof body.notes === 'string') { sets.push('notes = ?'); params.push(body.notes); }
  if (sets.length === 0) return c.json({ ok: true });
  params.push(id);
  await c.env.DB.prepare(`UPDATE callbacks SET ${sets.join(', ')} WHERE id = ?`).bind(...params).run();
  const updated = await c.env.DB.prepare('SELECT * FROM callbacks WHERE id = ?').bind(id).first<Callback>();
  log('info', 'callbacks', `Callback ${id} updated`, { status: body.status });
  return c.json({ callback: updated });
});
