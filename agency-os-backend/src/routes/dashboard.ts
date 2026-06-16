// Dashboard — landing-page aggregator and per-view aggregations.
//
// /api/dashboard returns one JSON blob with everything the calling-day
// landing view needs (today's sessions, priority strip data). Avoids a
// waterfall of small fetches; the page can render in one round-trip.

import { Hono } from 'hono';
import type { Env, Session, Callback } from '../types';
import { log } from '../utils/errors';
import { chicagoToday, chicagoCallingMode, chicagoCallingWeek } from '../services/dayOfWeek';
import { INDUSTRY_ROTATION } from '../services/sessionComposer';
import { callClaude } from '../services/claude';
import { buildPitchCardPrompt, leadToPitchCardInput } from '../prompts/pitchCard';
import type { Lead } from '../types';
import { badRequest, notFound, serverError } from '../utils/errors';

export const dashboardRouter = new Hono<{ Bindings: Env }>();

// GET /api/dashboard — the landing call.
dashboardRouter.get('/', async (c) => {
  const today = chicagoToday();
  const mode = chicagoCallingMode();

  // Run the priority-strip queries in parallel.
  const [
    sessionsToday,
    demosAwaiting,
    noShowRecovery,
    demosToday,
    callbacksDue,
  ] = await Promise.all([
    c.env.DB.prepare(`SELECT * FROM sessions WHERE session_date = ? ORDER BY block ASC`).bind(today).all<Session>(),
    c.env.DB.prepare(`
      SELECT d.*, l.company, l.phone, l.city, l.state
      FROM demos d INNER JOIN leads l ON l.id = d.lead_id
      WHERE d.status = 'booked' AND date(d.scheduled_for) < ?
      ORDER BY d.scheduled_for ASC LIMIT 20
    `).bind(today).all(),
    c.env.DB.prepare(`
      SELECT d.*, l.company, l.phone, l.city, l.state
      FROM demos d INNER JOIN leads l ON l.id = d.lead_id
      WHERE d.status = 'no_show'
        AND (l.last_called_at IS NULL OR l.last_called_at < d.status_set_at)
      ORDER BY d.status_set_at DESC LIMIT 20
    `).all(),
    c.env.DB.prepare(`
      SELECT d.*, l.company, l.phone, l.city, l.state
      FROM demos d INNER JOIN leads l ON l.id = d.lead_id
      WHERE d.status = 'booked' AND date(d.scheduled_for) = ?
      ORDER BY d.scheduled_for ASC
    `).bind(today).all(),
    c.env.DB.prepare(`
      SELECT cb.*, l.company, l.phone
      FROM callbacks cb INNER JOIN leads l ON l.id = cb.lead_id
      WHERE cb.due_date <= ? AND cb.status = 'pending'
      ORDER BY cb.due_date ASC, cb.id ASC LIMIT 50
    `).bind(today).all(),
  ]);

  return c.json({
    today,
    mode,
    sessions: sessionsToday.results ?? [],
    priorityStrip: {
      demosAwaitingStatus: demosAwaiting.results ?? [],
      noShowRecovery: noShowRecovery.results ?? [],
      demosToday: demosToday.results ?? [],
      callbacksDue: callbacksDue.results ?? [],
    },
  });
});

// GET /api/dashboard/week-review?week=YYYY-WW — Friday view aggregations.
// Pulls metrics from session_leads + demos for the calling week containing
// the reference date (or current week if omitted).
dashboardRouter.get('/week-review', async (c) => {
  const ref = c.req.query('date')
    ? new Date(`${c.req.query('date')}T12:00:00-06:00`)
    : new Date();
  const week = chicagoCallingWeek(ref);

  // Total dials, demos booked, demos held, booking rate, by-industry breakdown.
  const dialsRow = await c.env.DB.prepare(`
    SELECT COUNT(*) as n FROM session_leads sl
    INNER JOIN sessions s ON s.id = sl.session_id
    WHERE s.session_date BETWEEN ? AND ?
      AND sl.call_outcome IS NOT NULL
      AND sl.call_outcome != 'skipped'
  `).bind(week.monday, week.friday).first<{ n: number }>();

  const bookedRow = await c.env.DB.prepare(`
    SELECT COUNT(*) as n FROM session_leads sl
    INNER JOIN sessions s ON s.id = sl.session_id
    WHERE s.session_date BETWEEN ? AND ? AND sl.call_outcome = 'booked'
  `).bind(week.monday, week.friday).first<{ n: number }>();

  const heldRow = await c.env.DB.prepare(`
    SELECT COUNT(*) as n FROM demos
    WHERE status = 'held' AND date(scheduled_for) BETWEEN ? AND ?
  `).bind(week.monday, week.friday).first<{ n: number }>();

  const noShowRow = await c.env.DB.prepare(`
    SELECT COUNT(*) as n FROM demos
    WHERE status = 'no_show' AND date(scheduled_for) BETWEEN ? AND ?
  `).bind(week.monday, week.friday).first<{ n: number }>();

  const byIndustry = await c.env.DB.prepare(`
    SELECT s.industry,
      COUNT(*) as dials,
      SUM(CASE WHEN sl.call_outcome = 'booked' THEN 1 ELSE 0 END) as booked
    FROM session_leads sl
    INNER JOIN sessions s ON s.id = sl.session_id
    WHERE s.session_date BETWEEN ? AND ?
      AND sl.call_outcome IS NOT NULL AND sl.call_outcome != 'skipped'
    GROUP BY s.industry
    ORDER BY dials DESC
  `).bind(week.monday, week.friday).all<{ industry: string; dials: number; booked: number }>();

  // Missed callbacks (due during the week + still pending).
  const missedCallbacks = await c.env.DB.prepare(`
    SELECT cb.*, l.company, l.phone
    FROM callbacks cb INNER JOIN leads l ON l.id = cb.lead_id
    WHERE cb.due_date BETWEEN ? AND ? AND cb.status = 'pending'
    ORDER BY cb.due_date ASC
  `).bind(week.monday, week.friday).all<Callback>();

  const totalDials = dialsRow?.n ?? 0;
  const booked = bookedRow?.n ?? 0;
  const bookingRate = totalDials > 0 ? booked / totalDials : 0;

  return c.json({
    week,
    metrics: {
      totalDials,
      demosBooked: booked,
      demosHeld: heldRow?.n ?? 0,
      demosNoShow: noShowRow?.n ?? 0,
      bookingRate,
    },
    byIndustry: byIndustry.results ?? [],
    missedCallbacks: missedCallbacks.results ?? [],
  });
});

// GET /api/dashboard/prospecting-progress — current-week prospecting counter.
// "Prospected" = lead.created_at within the current calling week.
dashboardRouter.get('/prospecting-progress', async (c) => {
  const week = chicagoCallingWeek();
  const row = await c.env.DB.prepare(`
    SELECT COUNT(*) as n FROM leads
    WHERE date(created_at) BETWEEN ? AND ? AND deleted_at IS NULL
  `).bind(week.monday, week.friday).first<{ n: number }>();
  return c.json({ week, count: row?.n ?? 0, target: 50 });
});

// GET /api/dashboard/industries — surface the rotation list for the UI.
// Returns key+label pairs so the Edit Session modal can show friendly names
// while still passing the lead-matching key back on save.
dashboardRouter.get('/industries', (c) => {
  return c.json({ industries: INDUSTRY_ROTATION });
});

// POST /api/dashboard/leads/:id/pitch-card — on-demand pitch card generation.
// Operator-triggered ONLY (the ↻ button in the execution view). Caches on
// the lead row to avoid repeated cost. Calls Claude Haiku.
dashboardRouter.post('/leads/:id/pitch-card', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) return c.json(badRequest('Invalid lead ID'), 400);

  const lead = await c.env.DB.prepare('SELECT * FROM leads WHERE id = ?').bind(id).first<Lead>();
  if (!lead) return c.json(notFound('Lead'), 404);

  const prompt = buildPitchCardPrompt(leadToPitchCardInput(lead));
  let text: string;
  try {
    text = await callClaude(c.env.CLAUDE_API_KEY, prompt, { maxTokens: 300, temperature: 0.55 });
  } catch (err) {
    log('error', 'pitch-card', `Generation failed for lead ${id}`, err);
    return c.json(serverError(`Pitch card generation failed: ${(err as Error).message}`), 502);
  }

  const trimmed = text.trim();
  const now = new Date().toISOString();
  await c.env.DB.prepare(
    `UPDATE leads SET pitch_card_text = ?, pitch_card_generated_at = ?, updated_at = ? WHERE id = ?`
  ).bind(trimmed, now, now, id).run();
  log('info', 'pitch-card', `Generated for lead ${id}`, { chars: trimmed.length });

  return c.json({ pitch_card_text: trimmed, generated_at: now });
});
