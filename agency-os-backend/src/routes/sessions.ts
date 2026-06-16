// Calling sessions — composition, lifecycle, outcomes.
//
// Endpoints (all mounted at /api/sessions):
//   GET    /today                  — today's 2 sessions (or empty if not a calling day)
//   GET    /week?date=YYYY-MM-DD   — Mon-Fri sessions for the week containing date
//   GET    /:id                    — one session + its lead list
//   POST   /generate-week          — auto-generate 6 sessions for the next calling week
//   PUT    /:id                    — update composition (Edit modal)
//   POST   /:id/start              — flip to active (rejects if another session active)
//   POST   /:id/extend             — body { count }, add N more leads with widening
//   POST   /:id/complete           — wrap; computes recap
//   GET    /:id/next-lead          — next uncalled lead in active session
//   POST   /:id/outcome            — body { leadId, outcome, notes, callbackDate?, demoData? }

import { Hono } from 'hono';
import type {
  Env, Session, SessionBlock, SessionStatus,
  CallOutcome, SessionLead, Demo,
} from '../types';
import { badRequest, conflict, notFound, log } from '../utils/errors';
import {
  chicagoToday, chicagoCallingMode, chicagoCallingWeek,
} from '../services/dayOfWeek';
import {
  INDUSTRY_ROTATION, nextIndustry, composeWithWidening,
  type CompositionFilter,
} from '../services/sessionComposer';

export const sessionsRouter = new Hono<{ Bindings: Env }>();

// --------------------------------------------------------------------
// GET /today — sessions scheduled for today
// --------------------------------------------------------------------
sessionsRouter.get('/today', async (c) => {
  const today = chicagoToday();
  const mode = chicagoCallingMode();
  const sessions = await c.env.DB
    .prepare(`SELECT * FROM sessions WHERE session_date = ? ORDER BY CASE block WHEN 'morning' THEN 0 ELSE 1 END`)
    .bind(today)
    .all<Session>();
  return c.json({ date: today, mode, sessions: sessions.results ?? [] });
});

// --------------------------------------------------------------------
// GET /week?date=YYYY-MM-DD — Mon-Fri sessions for that week
// --------------------------------------------------------------------
sessionsRouter.get('/week', async (c) => {
  const dateParam = c.req.query('date');
  const ref = dateParam ? new Date(`${dateParam}T12:00:00-06:00`) : new Date();
  const week = chicagoCallingWeek(ref);
  const sessions = await c.env.DB
    .prepare(`SELECT * FROM sessions WHERE session_date BETWEEN ? AND ? ORDER BY session_date, CASE block WHEN 'morning' THEN 0 ELSE 1 END`)
    .bind(week.monday, week.friday)
    .all<Session>();
  return c.json({ week, sessions: sessions.results ?? [] });
});

// --------------------------------------------------------------------
// GET /:id — session detail + leads
// --------------------------------------------------------------------
sessionsRouter.get('/:id', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) return c.json(badRequest('Invalid session ID'), 400);

  const session = await c.env.DB
    .prepare('SELECT * FROM sessions WHERE id = ?')
    .bind(id)
    .first<Session>();
  if (!session) return c.json(notFound('Session'), 404);

  // Join session_leads → leads. Result is ordered by position with callbacks
  // pinned to the top (is_callback DESC) so the execution view consumes the
  // list as-is.
  const result = await c.env.DB
    .prepare(`
      SELECT
        l.*,
        sl.id AS session_lead_id,
        sl.position,
        sl.call_outcome,
        sl.called_at,
        sl.is_callback
      FROM session_leads sl
      INNER JOIN leads l ON l.id = sl.lead_id
      WHERE sl.session_id = ?
      ORDER BY sl.is_callback DESC, sl.position ASC
    `)
    .bind(id)
    .all();

  return c.json({ session, leads: result.results ?? [] });
});

// --------------------------------------------------------------------
// POST /generate-week — auto-generate 6 sessions for the next calling week
// --------------------------------------------------------------------
sessionsRouter.post('/generate-week', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { weekStart?: string };
  // Default to the calling week containing today (or next week if it's the weekend).
  const ref = body.weekStart ? new Date(`${body.weekStart}T12:00:00-06:00`) : new Date();
  const week = chicagoCallingWeek(ref);
  const callingDates = [week.tuesday, week.wednesday, week.thursday];

  // Industry rotation pulls from weekly_rotation single-row table.
  const rotation = await c.env.DB
    .prepare(`SELECT last_industry FROM weekly_rotation WHERE id = 1`)
    .first<{ last_industry: string | null }>();

  let lastIndustry = rotation?.last_industry ?? null;
  const created: Session[] = [];
  const skipped: Array<{ date: string; block: SessionBlock; reason: string }> = [];

  for (const date of callingDates) {
    const industry = nextIndustry(lastIndustry);
    // Store the KEY (e.g., 'plumber') in session.industry so the composer's
    // SQL match against leads.industry works. Label is computed in the UI
    // via industryLabel().
    lastIndustry = industry.key;

    for (const block of ['morning', 'evening'] as SessionBlock[]) {
      // Skip if already exists (unique idx idx_session_unique).
      const existing = await c.env.DB
        .prepare(`SELECT id FROM sessions WHERE session_date = ? AND block = ?`)
        .bind(date, block).first();
      if (existing) {
        skipped.push({ date, block, reason: 'already exists' });
        continue;
      }
      const ins = await c.env.DB.prepare(`
        INSERT INTO sessions (session_date, block, industry, score_floor, lead_count_target, status)
        VALUES (?, ?, ?, 50, 40, 'planned')
        RETURNING *
      `).bind(date, block, industry.key).first<Session>();
      if (ins) created.push(ins);
    }
  }

  // Persist rotation cursor so next week picks up correctly.
  await c.env.DB.prepare(
    `UPDATE weekly_rotation SET last_industry = ?, last_session_at = datetime('now'), updated_at = datetime('now') WHERE id = 1`
  ).bind(lastIndustry).run();

  log('info', 'sessions', `Generated ${created.length} sessions for week ${week.monday}`, { skipped: skipped.length });
  return c.json({ week, created, skipped });
});

// --------------------------------------------------------------------
// PUT /:id — update composition (Edit modal); only allowed for planned
// --------------------------------------------------------------------
const ALLOWED_FIELDS = ['industry', 'geographic_filter', 'score_floor', 'lead_count_target'] as const;
sessionsRouter.put('/:id', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) return c.json(badRequest('Invalid session ID'), 400);

  const session = await c.env.DB.prepare('SELECT * FROM sessions WHERE id = ?').bind(id).first<Session>();
  if (!session) return c.json(notFound('Session'), 404);
  if (session.status !== 'planned') {
    return c.json(badRequest('Only planned sessions can be edited'), 400);
  }

  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const updates: string[] = [];
  const params: unknown[] = [];
  for (const f of ALLOWED_FIELDS) {
    if (f in body) {
      updates.push(`${f} = ?`);
      const v = body[f];
      params.push(Array.isArray(v) ? JSON.stringify(v) : v);
    }
  }
  if (updates.length === 0) return c.json({ session });

  params.push(id);
  await c.env.DB.prepare(`UPDATE sessions SET ${updates.join(', ')} WHERE id = ?`).bind(...params).run();
  const updated = await c.env.DB.prepare('SELECT * FROM sessions WHERE id = ?').bind(id).first<Session>();
  return c.json({ session: updated });
});

// --------------------------------------------------------------------
// POST /:id/start — activate session + materialize the lead pool
// --------------------------------------------------------------------
sessionsRouter.post('/:id/start', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) return c.json(badRequest('Invalid session ID'), 400);

  const session = await c.env.DB.prepare('SELECT * FROM sessions WHERE id = ?').bind(id).first<Session>();
  if (!session) return c.json(notFound('Session'), 404);
  if (session.status === 'complete') return c.json(badRequest('Session already complete'), 400);

  // Active-session-exclusivity: reject if another session is active.
  if (session.status === 'planned') {
    const active = await c.env.DB
      .prepare(`SELECT id, session_date, block FROM sessions WHERE status = 'active' LIMIT 1`)
      .first<{ id: number; session_date: string; block: string }>();
    if (active && active.id !== id) {
      return c.json(conflict(
        `Another session is still active (${active.session_date} ${active.block}). Wrap it first.`
      ), 409);
    }
  }

  // If session is planned + has no leads yet, compose now.
  const existingCount = await c.env.DB
    .prepare(`SELECT COUNT(*) as n FROM session_leads WHERE session_id = ?`)
    .bind(id).first<{ n: number }>();

  if (session.status === 'planned' && (existingCount?.n ?? 0) === 0) {
    const filter: CompositionFilter = {
      industry: session.industry,
      scoreFloor: session.score_floor,
      geographicFilter: parseJsonArray(session.geographic_filter),
      excludeRecentlyCalled: true,
      excludeLeadIds: await getWeekExclusionIds(c.env, session.session_date),
      limit: session.lead_count_target,
    };
    const { leads } = await composeWithWidening(c.env, filter, session.lead_count_target);

    // Insert in score order, callbacks first (position-wise we just stamp the
    // composed order; is_callback comes from the callbacks table separately).
    // Also pin any pending callbacks for this lead due on or before today.
    const callbackLeads = await c.env.DB
      .prepare(`SELECT lead_id FROM callbacks WHERE due_date <= ? AND status = 'pending'`)
      .bind(session.session_date).all<{ lead_id: number }>();
    const callbackSet = new Set((callbackLeads.results ?? []).map((r) => r.lead_id));

    let pos = 0;
    for (const lead of leads) {
      const isCb = callbackSet.has(lead.id) ? 1 : 0;
      await c.env.DB.prepare(
        `INSERT INTO session_leads (session_id, lead_id, position, is_callback) VALUES (?, ?, ?, ?)`
      ).bind(id, lead.id, pos++, isCb).run();
    }
    log('info', 'sessions', `Composed ${leads.length} leads for session ${id}`);
  }

  await c.env.DB.prepare(
    `UPDATE sessions SET status = 'active', started_at = datetime('now') WHERE id = ?`
  ).bind(id).run();

  const updated = await c.env.DB.prepare('SELECT * FROM sessions WHERE id = ?').bind(id).first<Session>();
  return c.json({ session: updated });
});

// --------------------------------------------------------------------
// POST /:id/extend — body { count = 20 }, append more leads with widening
// --------------------------------------------------------------------
sessionsRouter.post('/:id/extend', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) return c.json(badRequest('Invalid session ID'), 400);
  const body = (await c.req.json().catch(() => ({}))) as { count?: number };
  const count = Math.max(1, Math.min(100, body.count ?? 20));

  const session = await c.env.DB.prepare('SELECT * FROM sessions WHERE id = ?').bind(id).first<Session>();
  if (!session) return c.json(notFound('Session'), 404);

  // Exclude leads already in this session.
  const inSession = await c.env.DB
    .prepare(`SELECT lead_id FROM session_leads WHERE session_id = ?`)
    .bind(id).all<{ lead_id: number }>();
  const excludeIds = (inSession.results ?? []).map((r) => r.lead_id);
  // Also exclude leads in other sessions THIS WEEK (don't double-book).
  const weekIds = await getWeekExclusionIds(c.env, session.session_date);
  const allExclude = Array.from(new Set([...excludeIds, ...weekIds]));

  const baseFilter: CompositionFilter = {
    industry: session.industry,
    scoreFloor: session.score_floor,
    geographicFilter: parseJsonArray(session.geographic_filter),
    excludeRecentlyCalled: true,
    excludeLeadIds: allExclude,
    limit: count,
  };
  const { leads, appliedFilter, widened } = await composeWithWidening(c.env, baseFilter, count);

  // Next position picks up from current max.
  const maxPos = await c.env.DB
    .prepare(`SELECT COALESCE(MAX(position), -1) as p FROM session_leads WHERE session_id = ?`)
    .bind(id).first<{ p: number }>();
  let pos = (maxPos?.p ?? -1) + 1;

  for (const lead of leads) {
    await c.env.DB.prepare(
      `INSERT INTO session_leads (session_id, lead_id, position) VALUES (?, ?, ?)`
    ).bind(id, lead.id, pos++).run();
  }

  log('info', 'sessions', `Extended session ${id} by ${leads.length} (target ${count})`, {
    widened: widened.length,
  });

  return c.json({ added: leads.length, appliedFilter, widened });
});

// --------------------------------------------------------------------
// POST /:id/complete — wrap session, compute recap
// --------------------------------------------------------------------
sessionsRouter.post('/:id/complete', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) return c.json(badRequest('Invalid session ID'), 400);

  const session = await c.env.DB.prepare('SELECT * FROM sessions WHERE id = ?').bind(id).first<Session>();
  if (!session) return c.json(notFound('Session'), 404);

  await c.env.DB.prepare(
    `UPDATE sessions SET status = 'complete', completed_at = datetime('now') WHERE id = ?`
  ).bind(id).run();

  const recap = await sessionRecap(c.env, id);
  log('info', 'sessions', `Session ${id} complete`, recap);
  return c.json({ session: { ...session, status: 'complete' as SessionStatus }, recap });
});

// --------------------------------------------------------------------
// GET /:id/next-lead — next uncalled lead, ordered by callback-first
// --------------------------------------------------------------------
sessionsRouter.get('/:id/next-lead', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) return c.json(badRequest('Invalid session ID'), 400);

  const row = await c.env.DB.prepare(`
    SELECT l.*, sl.position, sl.is_callback, sl.id as session_lead_id
    FROM session_leads sl
    INNER JOIN leads l ON l.id = sl.lead_id
    WHERE sl.session_id = ? AND sl.call_outcome IS NULL
    ORDER BY sl.is_callback DESC, sl.position ASC
    LIMIT 1
  `).bind(id).first();

  if (!row) return c.json({ lead: null, done: true });

  // Total + completed counts for the progress display.
  const totals = await c.env.DB.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN call_outcome IS NOT NULL THEN 1 ELSE 0 END) as called
    FROM session_leads WHERE session_id = ?
  `).bind(id).first<{ total: number; called: number }>();

  return c.json({ lead: row, done: false, total: totals?.total ?? 0, called: totals?.called ?? 0 });
});

// --------------------------------------------------------------------
// POST /:id/outcome — body { leadId, outcome, notes?, callbackDate?, demoData? }
// Single endpoint for all five outcomes. Writes call_log, updates
// session_leads + leads, optionally creates callback or demo row.
// --------------------------------------------------------------------
interface OutcomeBody {
  leadId: number;
  outcome: CallOutcome;
  notes?: string;
  callbackDate?: string;          // YYYY-MM-DD, required when outcome='callback'
  blockHint?: SessionBlock;        // optional, for callbacks
  demoData?: {                     // required when outcome='booked'
    scheduledFor: string;          // ISO datetime
    honeybookConfirmed?: boolean;
  };
}
sessionsRouter.post('/:id/outcome', async (c) => {
  const sessionId = parseInt(c.req.param('id'), 10);
  if (isNaN(sessionId)) return c.json(badRequest('Invalid session ID'), 400);

  const body = (await c.req.json().catch(() => ({}))) as Partial<OutcomeBody>;
  if (!body.leadId || !body.outcome) {
    return c.json(badRequest('leadId + outcome are required'), 400);
  }

  const VALID: CallOutcome[] = ['voicemail', 'not_interested', 'callback', 'booked', 'skipped'];
  if (!VALID.includes(body.outcome)) {
    return c.json(badRequest(`Invalid outcome '${body.outcome}'`), 400);
  }

  const session = await c.env.DB.prepare('SELECT * FROM sessions WHERE id = ?').bind(sessionId).first<Session>();
  if (!session) return c.json(notFound('Session'), 404);

  const sl = await c.env.DB
    .prepare(`SELECT * FROM session_leads WHERE session_id = ? AND lead_id = ?`)
    .bind(sessionId, body.leadId)
    .first<SessionLead>();
  if (!sl) return c.json(notFound('Lead not in this session'), 404);

  const now = new Date().toISOString();
  const notes = body.notes?.trim() ?? '';

  // 1. Write the call_log entry (except skipped — those are silent advances).
  if (body.outcome !== 'skipped') {
    await c.env.DB.prepare(
      `INSERT INTO call_log (lead_id, outcome, notes) VALUES (?, ?, ?)`
    ).bind(body.leadId, body.outcome, notes).run();
  }

  // 2. Update session_leads with the outcome.
  await c.env.DB.prepare(
    `UPDATE session_leads SET call_outcome = ?, called_at = ? WHERE id = ?`
  ).bind(body.outcome, now, sl.id).run();

  // 3. Update lead row (last_called_at, lifecycle status when applicable).
  if (body.outcome === 'skipped') {
    // Silent advance — no last_called_at update so the lead doesn't get
    // 14-day-excluded by a non-call.
  } else if (body.outcome === 'not_interested') {
    await c.env.DB.prepare(
      `UPDATE leads SET last_called_at = ?, status = 'not_interested', updated_at = ? WHERE id = ?`
    ).bind(now, now, body.leadId).run();
  } else if (body.outcome === 'booked') {
    // Demo creation handled below; also flip lead → 'qualified'.
    await c.env.DB.prepare(
      `UPDATE leads SET last_called_at = ?, status = 'qualified', demo_booked_at = ?, demo_scheduled_for = ?, updated_at = ? WHERE id = ?`
    ).bind(now, now, body.demoData?.scheduledFor ?? null, now, body.leadId).run();
  } else {
    // voicemail | callback — promote cold → contacted if applicable.
    await c.env.DB.prepare(`
      UPDATE leads SET
        last_called_at = ?,
        status = CASE WHEN status = 'cold' THEN 'contacted' ELSE status END,
        updated_at = ?
      WHERE id = ?
    `).bind(now, now, body.leadId).run();
  }

  // 4. Side-effects per outcome.
  let demo: Demo | null = null;
  let callbackId: number | null = null;

  if (body.outcome === 'callback') {
    if (!body.callbackDate) {
      return c.json(badRequest(`callback outcome requires callbackDate`), 400);
    }
    const cb = await c.env.DB.prepare(`
      INSERT INTO callbacks (lead_id, due_date, block_hint, notes, status)
      VALUES (?, ?, ?, ?, 'pending') RETURNING id
    `).bind(body.leadId, body.callbackDate, body.blockHint ?? null, notes || null).first<{ id: number }>();
    callbackId = cb?.id ?? null;
  } else if (body.outcome === 'booked') {
    if (!body.demoData?.scheduledFor) {
      return c.json(badRequest(`booked outcome requires demoData.scheduledFor`), 400);
    }
    demo = await c.env.DB.prepare(`
      INSERT INTO demos (lead_id, scheduled_for, status, honeybook_confirmed, outcome_notes)
      VALUES (?, ?, 'booked', ?, ?)
      RETURNING *
    `).bind(
      body.leadId,
      body.demoData.scheduledFor,
      body.demoData.honeybookConfirmed ? 1 : 0,
      notes || null,
    ).first<Demo>();

    if (demo) {
      await c.env.DB.prepare(
        `INSERT INTO demo_events (demo_id, event_type, event_data) VALUES (?, 'created', ?)`
      ).bind(demo.id, JSON.stringify({ scheduledFor: body.demoData.scheduledFor })).run();
    }
  }

  log('info', 'sessions', `Outcome '${body.outcome}' recorded`, {
    sessionId, leadId: body.leadId, demoId: demo?.id, callbackId,
  });

  return c.json({ ok: true, demo, callbackId });
});

// --------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------

function parseJsonArray(raw: string | null): string[] | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : null;
  } catch { return null; }
}

// Returns lead IDs already booked into any session within the calling week
// that contains `date`. Prevents double-booking the same lead across morning
// + evening on the same day, or across multiple days in the same week.
async function getWeekExclusionIds(env: Env, date: string): Promise<number[]> {
  const ref = new Date(`${date}T12:00:00-06:00`);
  const week = chicagoCallingWeek(ref);
  const result = await env.DB
    .prepare(`
      SELECT DISTINCT sl.lead_id
      FROM session_leads sl
      INNER JOIN sessions s ON s.id = sl.session_id
      WHERE s.session_date BETWEEN ? AND ?
    `)
    .bind(week.monday, week.friday)
    .all<{ lead_id: number }>();
  return (result.results ?? []).map((r) => r.lead_id);
}

interface SessionRecap {
  total: number;
  called: number;
  voicemails: number;
  notInterested: number;
  callbacks: number;
  booked: number;
  skipped: number;
  bookingRate: number;
}
async function sessionRecap(env: Env, sessionId: number): Promise<SessionRecap> {
  const rows = await env.DB.prepare(`
    SELECT call_outcome, COUNT(*) as n
    FROM session_leads
    WHERE session_id = ?
    GROUP BY call_outcome
  `).bind(sessionId).all<{ call_outcome: string | null; n: number }>();

  let total = 0, called = 0, voicemails = 0, notInterested = 0, callbacks = 0, booked = 0, skipped = 0;
  for (const r of rows.results ?? []) {
    total += r.n;
    if (r.call_outcome === null) continue;
    called += r.n;
    if (r.call_outcome === 'voicemail') voicemails = r.n;
    if (r.call_outcome === 'not_interested') notInterested = r.n;
    if (r.call_outcome === 'callback') callbacks = r.n;
    if (r.call_outcome === 'booked') booked = r.n;
    if (r.call_outcome === 'skipped') skipped = r.n;
  }
  const dialedForBooking = called - skipped; // skips don't count toward booking-rate denominator
  const bookingRate = dialedForBooking > 0 ? booked / dialedForBooking : 0;
  return { total, called, voicemails, notInterested, callbacks, booked, skipped, bookingRate };
}

// Export rotation list for the dashboard endpoint to surface in the UI.
export { INDUSTRY_ROTATION };
