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
import { getObjection } from '../services/playbook';
import type { Lead } from '../types';
import { badRequest, notFound, serverError } from '../utils/errors';

export const dashboardRouter = new Hono<{ Bindings: Env }>();

function pct(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  return Number(((numerator / denominator) * 100).toFixed(1));
}

function delta(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null) return null;
  return Number((current - previous).toFixed(1));
}

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
    voicemailsToRedial,
  ] = await Promise.all([
    c.env.DB.prepare(`SELECT * FROM sessions WHERE session_date = ? ORDER BY CASE block WHEN 'morning' THEN 0 ELSE 1 END`).bind(today).all<Session>(),
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
    // Voicemails to redial — leads where we left a voicemail recently and
    // still need to reach them. Excludes not_interested / dead / qualified
    // / client (those don't need a redial). Ordered oldest-first so the
    // aging ones surface at the top.
    c.env.DB.prepare(`
      SELECT id, company, phone, city, state, last_called_at, industry
      FROM leads
      WHERE outcome = 'Voicemail Left'
        AND last_called_at IS NOT NULL
        AND last_called_at >= datetime('now', '-14 day')
        AND status IN ('cold', 'contacted')
        AND deleted_at IS NULL
      ORDER BY last_called_at ASC
      LIMIT 50
    `).all(),
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
      voicemailsToRedial: voicemailsToRedial.results ?? [],
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

// GET /api/dashboard/agency-summary?range=30d|all — overall calling metrics.
// "Vs industry" deltas were called out in the original spec but the operator
// asked to skip them — these are raw numbers + simple derived rates.
dashboardRouter.get('/agency-summary', async (c) => {
  const range = c.req.query('range') === 'all' ? 'all' : '30d';
  // sqlite-compatible date threshold. '1970-01-01' for "all".
  const since = range === '30d'
    ? `date('now', '-30 day')`
    : `'1970-01-01'`;

  const callsRow = await c.env.DB.prepare(`
    SELECT COUNT(*) as total_calls,
           COUNT(DISTINCT s.session_date) as call_days
    FROM session_leads sl
    INNER JOIN sessions s ON s.id = sl.session_id
    WHERE s.session_date >= ${since}
      AND sl.call_outcome IS NOT NULL
      AND sl.call_outcome != 'skipped'
  `).first<{ total_calls: number; call_days: number }>();

  const bookedRow = await c.env.DB.prepare(`
    SELECT COUNT(*) as n FROM session_leads sl
    INNER JOIN sessions s ON s.id = sl.session_id
    WHERE s.session_date >= ${since} AND sl.call_outcome = 'booked'
  `).first<{ n: number }>();

  const heldRow = await c.env.DB.prepare(`
    SELECT COUNT(*) as n FROM demos
    WHERE status = 'held' AND date(scheduled_for) >= ${since}
  `).first<{ n: number }>();

  const noShowRow = await c.env.DB.prepare(`
    SELECT COUNT(*) as n FROM demos
    WHERE status = 'no_show' AND date(scheduled_for) >= ${since}
  `).first<{ n: number }>();

  const newProjectsRow = await c.env.DB.prepare(`
    SELECT COUNT(*) as n FROM projects WHERE date(created_at) >= ${since}
  `).first<{ n: number }>();

  const totalCalls = callsRow?.total_calls ?? 0;
  const callDays = callsRow?.call_days ?? 0;
  const callsPerDay = callDays > 0 ? totalCalls / callDays : 0;
  const demosBooked = bookedRow?.n ?? 0;

  return c.json({
    range,
    total_calls: totalCalls,
    call_days: callDays,
    calls_per_day: Number(callsPerDay.toFixed(1)),
    demos_booked: demosBooked,
    demos_held: heldRow?.n ?? 0,
    demos_no_show: noShowRow?.n ?? 0,
    dial_to_set_rate_pct: totalCalls > 0 ? Number(((demosBooked / totalCalls) * 100).toFixed(1)) : 0,
    new_projects: newProjectsRow?.n ?? 0,
  });
});

// GET /api/dashboard/objections-overview?range=30d|all — per-objection
// frequency + handled-rate. Reads call_log.objection_hits JSON, joined
// against the playbook for friendly labels.
dashboardRouter.get('/objections-overview', async (c) => {
  const range = c.req.query('range') === 'all' ? 'all' : '30d';
  const since = range === '30d'
    ? `date('now', '-30 day')`
    : `'1970-01-01'`;

  const totalCallsRow = await c.env.DB.prepare(`
    SELECT COUNT(*) as n FROM call_log WHERE date(created_at) >= ${since}
  `).first<{ n: number }>();
  const totalCalls = totalCallsRow?.n ?? 0;

  // D1 includes the json1 extension. json_each over a TEXT column that
  // contains a JSON array unrolls one row per array element.
  const hitsRows = await c.env.DB.prepare(`
    SELECT
      json_extract(je.value, '$.objection_id') as objection_id,
      COUNT(*) as total_hits,
      SUM(CASE WHEN json_extract(je.value, '$.handled') = 1 THEN 1 ELSE 0 END) as handled_count
    FROM call_log cl, json_each(cl.objection_hits) je
    WHERE cl.objection_hits IS NOT NULL
      AND date(cl.created_at) >= ${since}
    GROUP BY objection_id
    ORDER BY total_hits DESC
    LIMIT 10
  `).all<{ objection_id: string; total_hits: number; handled_count: number }>();

  const items = (hitsRows.results ?? []).map((r) => {
    const obj = getObjection(r.objection_id);
    return {
      objection_id: r.objection_id,
      label: obj?.label ?? r.objection_id,
      category: obj?.category ?? 'standard',
      type: obj?.type ?? 'simple',
      total_hits: r.total_hits,
      handled_count: r.handled_count,
      handled_rate_pct: r.total_hits > 0
        ? Number(((r.handled_count / r.total_hits) * 100).toFixed(1))
        : 0,
      frequency_pct: totalCalls > 0
        ? Number(((r.total_hits / totalCalls) * 100).toFixed(1))
        : 0,
    };
  });

  return c.json({
    range,
    total_calls: totalCalls,
    objections: items,
  });
});

// GET /api/dashboard/pipeline-kpis — top-level operating dashboard.
// KPI-first view over the text+site pipeline. "Replies" are intentionally
// returned as null until the app logs reply events as a first-class action;
// taps/engagement/bookings are real counters from lead_activity + sessions.
dashboardRouter.get('/pipeline-kpis', async (c) => {
  const week = chicagoCallingWeek();
  const weekStart = new Date(`${week.monday}T12:00:00-06:00`);
  const previousRef = new Date(weekStart);
  previousRef.setDate(previousRef.getDate() - 7);
  const previousWeek = chicagoCallingWeek(previousRef);

  async function funnelFor(start: string, end: string) {
    const sentRow = await c.env.DB.prepare(`
      SELECT COUNT(DISTINCT lead_id) as n
      FROM lead_activity
      WHERE action = 'intro_sent'
        AND date(created_at) BETWEEN ? AND ?
    `).bind(start, end).first<{ n: number }>();

    const tappedRow = await c.env.DB.prepare(`
      SELECT COUNT(DISTINCT lead_id) as n
      FROM lead_activity
      WHERE action = 'click_tracked'
        AND date(created_at) BETWEEN ? AND ?
    `).bind(start, end).first<{ n: number }>();

    const engagedRow = await c.env.DB.prepare(`
      SELECT COUNT(DISTINCT lead_id) as n
      FROM lead_activity
      WHERE action = 'click_tracked'
        AND to_status = 'engaged'
        AND date(created_at) BETWEEN ? AND ?
    `).bind(start, end).first<{ n: number }>();

    const bookedRow = await c.env.DB.prepare(`
      SELECT COUNT(*) as n
      FROM demos
      WHERE date(booked_at) BETWEEN ? AND ?
    `).bind(start, end).first<{ n: number }>();

    const sent = sentRow?.n ?? 0;
    const tapped = tappedRow?.n ?? 0;
    const engaged = engagedRow?.n ?? 0;
    const booked = bookedRow?.n ?? 0;
    const tapRate = pct(tapped, sent);
    const engagementRate = pct(engaged, sent);
    const replyPerTap = null;
    const bookRate = pct(booked, sent);

    return {
      sent,
      tapped,
      engaged,
      replies: null,
      booked,
      tapRate,
      engagementRate,
      replyPerTap,
      bookRate,
    };
  }

  const [current, previous, activeLeadsRow, hotLeads, smsCurrent, smsPrevious] = await Promise.all([
    funnelFor(week.monday, week.friday),
    funnelFor(previousWeek.monday, previousWeek.friday),
    c.env.DB.prepare(`
      SELECT COUNT(*) as n
      FROM leads
      WHERE deleted_at IS NULL
        AND status IN ('cold', 'contacted')
        AND enrichment_status = 'enriched'
        AND has_website = 0
    `).first<{ n: number }>(),
    c.env.DB.prepare(`
      SELECT
        l.id,
        l.company,
        l.phone,
        l.city,
        l.state,
        l.industry,
        l.pipeline_status,
        l.pipeline_sessions,
        l.pipeline_last_action_at,
        MAX(la.created_at) as last_engagement_at
      FROM leads l
      LEFT JOIN lead_activity la
        ON la.lead_id = l.id
       AND la.action = 'click_tracked'
      WHERE l.deleted_at IS NULL
        AND l.status IN ('cold', 'contacted')
        AND l.enrichment_status = 'enriched'
        AND l.has_website = 0
        AND (l.pipeline_status = 'engaged' OR l.pipeline_sessions > 0)
        AND NOT EXISTS (
          SELECT 1
          FROM lead_activity called
          WHERE called.lead_id = l.id
            AND called.action = 'called'
            AND datetime(called.created_at) >= datetime(COALESCE((
              SELECT MAX(c2.created_at)
              FROM lead_activity c2
              WHERE c2.lead_id = l.id
                AND c2.action = 'click_tracked'
            ), '1970-01-01'))
        )
      GROUP BY l.id
      ORDER BY datetime(COALESCE(last_engagement_at, l.pipeline_last_action_at, l.updated_at)) DESC
      LIMIT 8
    `).all<{
      id: number;
      company: string;
      phone: string | null;
      city: string | null;
      state: string | null;
      industry: string | null;
      pipeline_status: string;
      pipeline_sessions: number;
      pipeline_last_action_at: string | null;
      last_engagement_at: string | null;
    }>(),
    // The current automated pipeline sends through the SMS composer. Facebook
    // needs explicit channel logging before it can have real numbers here.
    funnelFor(week.monday, week.friday),
    funnelFor(previousWeek.monday, previousWeek.friday),
  ]);

  return c.json({
    week,
    previousWeek,
    hero: {
      hotLeadsReadyToCall: (hotLeads.results ?? []).length,
      thisWeekReplyRate: null,
      meetingsBookedThisWeek: current.booked,
      activeLeadsInPipeline: activeLeadsRow?.n ?? 0,
    },
    funnel: {
      current,
      previous,
      trends: {
        tapRate: delta(current.tapRate, previous.tapRate),
        engagementRate: delta(current.engagementRate, previous.engagementRate),
        replyPerTap: null,
        bookRate: delta(current.bookRate, previous.bookRate),
      },
    },
    channels: [
      {
        channel: 'SMS',
        current: smsCurrent,
        previous: smsPrevious,
        tracked: true,
      },
      {
        channel: 'Facebook',
        current: null,
        previous: null,
        tracked: false,
      },
    ],
    needsAction: hotLeads.results ?? [],
  });
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
