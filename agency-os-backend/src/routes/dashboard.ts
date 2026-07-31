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

function addDaysIso(iso: string, days: number): string {
  const t = new Date(`${iso}T00:00:00Z`).getTime() + days * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

function pipelineKpiWeek(d: Date = new Date()): {
  monday: string; tuesday: string; wednesday: string; thursday: string; friday: string; saturday: string; sunday: string;
} {
  const today = chicagoToday(d);
  const dayName = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    weekday: 'long',
  }).format(d).toLowerCase();
  const dayIndex: Record<string, number> = {
    monday: 0,
    tuesday: 1,
    wednesday: 2,
    thursday: 3,
    friday: 4,
    saturday: 5,
    sunday: 6,
  };
  const monday = addDaysIso(today, -(dayIndex[dayName] ?? 0));
  return {
    monday,
    tuesday: addDaysIso(monday, 1),
    wednesday: addDaysIso(monday, 2),
    thursday: addDaysIso(monday, 3),
    friday: addDaysIso(monday, 4),
    saturday: addDaysIso(monday, 5),
    sunday: addDaysIso(monday, 6),
  };
}

function pct(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  return Number(((numerator / denominator) * 100).toFixed(1));
}

function delta(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null) return null;
  return Number((current - previous).toFixed(1));
}

function countDelta(current: number, previous: number): number {
  return current - previous;
}

type TextOutreachRange = '7d' | '30d' | 'all';

function textOutreachSince(range: TextOutreachRange): string {
  if (range === '7d') return `date('now', '-7 day')`;
  if (range === '30d') return `date('now', '-30 day')`;
  return `'1970-01-01'`;
}

async function textOutreachActivity(
  db: Env['DB'],
  since: string,
): Promise<{
  sitesCreated: number;
  introTextsSent: number;
  followUpsSent: number;
  engagedLeads: number;
  totalVisits: number;
  sendByHour: Array<{ hour: number; intro: number; followUps: number; total: number }>;
}> {
  const [activityRow, messageRows] = await Promise.all([
    db.prepare(`
    SELECT
      COUNT(DISTINCT CASE WHEN action = 'intro_sent' THEN lead_id END) as intro_texts_sent,
      COUNT(DISTINCT CASE WHEN action = 'followed_up' THEN lead_id END) as follow_ups_sent,
      COUNT(DISTINCT CASE WHEN action = 'click_tracked' THEN lead_id END) as engaged_leads,
      COUNT(CASE WHEN action = 'click_tracked' THEN 1 END) as total_visits
    FROM lead_activity
    WHERE action IN ('intro_sent', 'followed_up', 'click_tracked')
      AND date(created_at) >= ${since}
  `).first<{
      intro_texts_sent: number | null;
      follow_ups_sent: number | null;
      engaged_leads: number | null;
      total_visits: number | null;
    }>(),
    db.prepare(`
      SELECT action, created_at
      FROM lead_activity
      WHERE action IN ('intro_sent', 'followed_up')
        AND date(created_at) >= ${since}
      ORDER BY created_at ASC
    `).all<{ action: 'intro_sent' | 'followed_up'; created_at: string }>(),
  ]);

  const sitesRow = await db.prepare(`
    SELECT COUNT(*) as n
    FROM leads
    WHERE deleted_at IS NULL
      AND status IN ('cold', 'contacted')
      AND enrichment_status = 'enriched'
      AND has_website = 0
      AND site_url IS NOT NULL
      AND pipeline_status NOT IN ('booked', 'archived')
      AND date(COALESCE(pipeline_last_action_at, updated_at, created_at)) >= ${since}
  `).first<{ n: number }>();

  const sendByHour = Array.from({ length: 24 }, (_, hour) => ({
    hour,
    intro: 0,
    followUps: 0,
    total: 0,
  }));
  const chicagoHour = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    hour: 'numeric',
    hourCycle: 'h23',
  });
  for (const row of messageRows.results) {
    const timestamp = row.created_at.includes('T')
      ? row.created_at
      : `${row.created_at.replace(' ', 'T')}Z`;
    const parsed = new Date(timestamp);
    if (Number.isNaN(parsed.getTime())) continue;
    const hour = Number.parseInt(chicagoHour.format(parsed), 10);
    if (!Number.isInteger(hour) || hour < 0 || hour > 23) continue;
    const bucket = sendByHour[hour];
    bucket.total += 1;
    if (row.action === 'intro_sent') bucket.intro += 1;
    else bucket.followUps += 1;
  }

  return {
    sitesCreated: sitesRow?.n ?? 0,
    introTextsSent: activityRow?.intro_texts_sent ?? 0,
    followUpsSent: activityRow?.follow_ups_sent ?? 0,
    engagedLeads: activityRow?.engaged_leads ?? 0,
    totalVisits: activityRow?.total_visits ?? 0,
    sendByHour,
  };
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

// GET /api/dashboard/text-outreach-activity?range=7d|30d|all — range-aware
// activity strip for the text outreach dashboard section.
dashboardRouter.get('/text-outreach-activity', async (c) => {
  const q = c.req.query('range');
  const range: TextOutreachRange = q === '7d' || q === 'all' ? q : '30d';
  const activity = await textOutreachActivity(c.env.DB, textOutreachSince(range));

  return c.json({
    range,
    activity,
  });
});

// GET /api/dashboard/pipeline-kpis — top-level operating dashboard.
// KPI-first view over the text+site pipeline. "Replies" are intentionally
// returned as null until the app logs reply events as a first-class action;
// taps/engagement/bookings are real counters from lead_activity + sessions.
dashboardRouter.get('/pipeline-kpis', async (c) => {
  // The automated text+site funnel is worked outside Tue/Wed/Thu calling
  // blocks, including weekends. Do not use chicagoCallingWeek() here: it
  // intentionally snaps Sat/Sun forward for the calling dashboard, which
  // hides same-week weekend sends/taps from the KPI cards.
  const week = pipelineKpiWeek();
  const weekStart = new Date(`${week.monday}T12:00:00-06:00`);
  const previousRef = new Date(weekStart);
  previousRef.setDate(previousRef.getDate() - 7);
  const previousWeek = pipelineKpiWeek(previousRef);
  const engagementRangeQuery = c.req.query('engagement_range');
  const engagementRange: TextOutreachRange = engagementRangeQuery === '7d' || engagementRangeQuery === 'all'
    ? engagementRangeQuery
    : '30d';
  const engagementEnd = chicagoToday();
  const engagementDays = engagementRange === '7d' ? 7 : 30;
  const engagementStart = engagementRange === 'all'
    ? '1970-01-01'
    : addDaysIso(engagementEnd, -(engagementDays - 1));
  const previousEngagementEnd = engagementRange === 'all'
    ? '1970-01-01'
    : addDaysIso(engagementStart, -1);
  const previousEngagementStart = engagementRange === 'all'
    ? '1970-01-01'
    : addDaysIso(previousEngagementEnd, -(engagementDays - 1));

  async function activityFor(start: string, end: string) {
    const row = await c.env.DB.prepare(`
      SELECT
        COUNT(DISTINCT CASE WHEN action = 'intro_sent' THEN lead_id END) as intro_texts_sent,
        COUNT(DISTINCT CASE WHEN action = 'followed_up' THEN lead_id END) as follow_ups_sent,
        COUNT(DISTINCT CASE WHEN action = 'click_tracked' THEN lead_id END) as engaged_leads,
        COUNT(CASE WHEN action = 'click_tracked' THEN 1 END) as total_visits
      FROM lead_activity
      WHERE action IN ('intro_sent', 'followed_up', 'click_tracked')
        AND date(created_at) BETWEEN ? AND ?
    `).bind(start, end).first<{
      intro_texts_sent: number | null;
      follow_ups_sent: number | null;
      engaged_leads: number | null;
      total_visits: number | null;
    }>();

    return {
      sitesCreated: 0,
      introTextsSent: row?.intro_texts_sent ?? 0,
      followUpsSent: row?.follow_ups_sent ?? 0,
      engagedLeads: row?.engaged_leads ?? 0,
      totalVisits: row?.total_visits ?? 0,
    };
  }

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

    // Reply metrics were removed 2026-07-21 by operator decision: replies
    // arrive on the operator's personal phone (sms: deep-link channel) and
    // aren't worth logging manually.
    return {
      sent,
      tapped,
      engaged,
      booked,
      tapRate: pct(tapped, sent),
      engagementRate: pct(engaged, sent),
      bookRate: pct(booked, sent),
    };
  }

  async function effectivenessFor(start: string, end: string) {
    const touchAttribution = await c.env.DB.prepare(`
      WITH valid_activity AS (
        SELECT activity.*
        FROM lead_activity activity
        WHERE activity.action != 'undo'
          AND NOT EXISTS (
            SELECT 1 FROM lead_activity undo
            WHERE undo.action = 'undo'
              AND json_extract(undo.meta, '$.undid_activity_id') = activity.id
          )
      ),
      send_touches AS (
        SELECT
          id,
          lead_id,
          created_at,
          CASE
            WHEN action = 'intro_sent' THEN 'intro'
            WHEN SUM(CASE WHEN action = 'followed_up' THEN 1 ELSE 0 END) OVER (
              PARTITION BY lead_id
              ORDER BY datetime(created_at), id
              ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
            ) = 1 THEN 'reminder'
            ELSE 'final_nudge'
          END AS stage
        FROM valid_activity
        WHERE action = 'intro_sent'
           OR (action = 'followed_up' AND from_status = 'sent_no_reply')
      ),
      first_engagement AS (
        SELECT id, lead_id, created_at
        FROM (
          SELECT
            id,
            lead_id,
            created_at,
            ROW_NUMBER() OVER (
              PARTITION BY lead_id
              ORDER BY datetime(created_at), id
            ) AS position
          FROM valid_activity
          WHERE action IN ('click_tracked', 'reply_received', 'calendar_clicked')
        )
        WHERE position = 1
      ),
      attributed_engagement AS (
        SELECT send.lead_id, send.stage, send.created_at AS sent_at, engagement.created_at AS engaged_at
        FROM send_touches send
        JOIN first_engagement engagement ON engagement.lead_id = send.lead_id
        WHERE (
          datetime(send.created_at) < datetime(engagement.created_at)
          OR (datetime(send.created_at) = datetime(engagement.created_at) AND send.id < engagement.id)
        )
          AND NOT EXISTS (
            SELECT 1
            FROM send_touches later_send
            WHERE later_send.lead_id = send.lead_id
              AND (
                datetime(later_send.created_at) > datetime(send.created_at)
                OR (datetime(later_send.created_at) = datetime(send.created_at) AND later_send.id > send.id)
              )
              AND (
                datetime(later_send.created_at) < datetime(engagement.created_at)
                OR (datetime(later_send.created_at) = datetime(engagement.created_at) AND later_send.id < engagement.id)
              )
          )
      )
      SELECT
        COUNT(DISTINCT CASE WHEN stage = 'intro' AND date(created_at) BETWEEN ? AND ? THEN lead_id END) AS intro_sent,
        COUNT(DISTINCT CASE WHEN stage = 'reminder' AND date(created_at) BETWEEN ? AND ? THEN lead_id END) AS reminder_sent,
        COUNT(DISTINCT CASE WHEN stage = 'final_nudge' AND date(created_at) BETWEEN ? AND ? THEN lead_id END) AS final_nudge_sent,
        (SELECT COUNT(DISTINCT lead_id) FROM attributed_engagement WHERE stage = 'intro' AND date(sent_at) BETWEEN ? AND ? AND date(engaged_at) <= ?) AS intro_engaged,
        (SELECT COUNT(DISTINCT lead_id) FROM attributed_engagement WHERE stage = 'reminder' AND date(sent_at) BETWEEN ? AND ? AND date(engaged_at) <= ?) AS reminder_engaged,
        (SELECT COUNT(DISTINCT lead_id) FROM attributed_engagement WHERE stage = 'final_nudge' AND date(sent_at) BETWEEN ? AND ? AND date(engaged_at) <= ?) AS final_nudge_engaged
      FROM send_touches
    `).bind(
      start, end, start, end, start, end,
      start, end, end, start, end, end, start, end, end,
    ).first<{
      intro_sent: number | null;
      reminder_sent: number | null;
      final_nudge_sent: number | null;
      intro_engaged: number | null;
      reminder_engaged: number | null;
      final_nudge_engaged: number | null;
    }>();

    const calendar = await c.env.DB.prepare(`
      WITH calendar_cohort AS (
        SELECT lead_id, MIN(created_at) AS opened_at
        FROM lead_activity
        WHERE action = 'calendar_clicked'
          AND date(created_at) BETWEEN ? AND ?
        GROUP BY lead_id
      )
      SELECT
        COUNT(*) AS opened,
        SUM(CASE WHEN EXISTS (
          SELECT 1 FROM demos
          WHERE demos.lead_id = cohort.lead_id
            AND datetime(demos.booked_at) >= datetime(cohort.opened_at)
        ) THEN 1 ELSE 0 END) AS booked
      FROM calendar_cohort cohort
    `).bind(start, end).first<{
      opened: number | null;
      booked: number | null;
    }>();

    const introSent = touchAttribution?.intro_sent ?? 0;
    const reminderSent = touchAttribution?.reminder_sent ?? 0;
    const finalNudgeSent = touchAttribution?.final_nudge_sent ?? 0;
    const introEngaged = touchAttribution?.intro_engaged ?? 0;
    const reminderEngaged = touchAttribution?.reminder_engaged ?? 0;
    const finalNudgeEngaged = touchAttribution?.final_nudge_engaged ?? 0;
    const calendarOpened = calendar?.opened ?? 0;
    const calendarBooked = calendar?.booked ?? 0;
    return {
      engagementByTouch: {
        intro: { sent: introSent, engaged: introEngaged, rate: pct(introEngaged, introSent) },
        reminder: { sent: reminderSent, engaged: reminderEngaged, rate: pct(reminderEngaged, reminderSent) },
        finalNudge: { sent: finalNudgeSent, engaged: finalNudgeEngaged, rate: pct(finalNudgeEngaged, finalNudgeSent) },
      },
      calendarOpened,
      calendarBooked,
      calendarBookingRate: pct(calendarBooked, calendarOpened),
    };
  }

  const [
    current,
    previous,
    currentActivity,
    previousActivity,
    activeLeadsRow,
    siteReadyRow,
    hotLeads,
    smsCurrent,
    smsPrevious,
    effectivenessCurrent,
    effectivenessPrevious,
  ] = await Promise.all([
    funnelFor(week.monday, week.sunday),
    funnelFor(previousWeek.monday, previousWeek.sunday),
    activityFor(week.monday, week.sunday),
    activityFor(previousWeek.monday, previousWeek.sunday),
    c.env.DB.prepare(`
      SELECT COUNT(*) as n
      FROM leads
      WHERE deleted_at IS NULL
        AND status IN ('cold', 'contacted')
        AND enrichment_status = 'enriched'
        AND has_website = 0
    `).first<{ n: number }>(),
    c.env.DB.prepare(`
      SELECT COUNT(*) as n
      FROM leads
      WHERE deleted_at IS NULL
        AND status IN ('cold', 'contacted')
        AND enrichment_status = 'enriched'
        AND has_website = 0
        AND site_url IS NOT NULL
        AND pipeline_status NOT IN ('booked', 'archived')
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
        l.engagement_score,
        l.engagement_grade,
        l.engagement_reasons,
        l.pipeline_last_action_at,
        CASE
          WHEN l.outcome = 'Email Captured'
            OR EXISTS (SELECT 1 FROM email_automations automation WHERE automation.lead_id = l.id)
            OR EXISTS (SELECT 1 FROM email_sends send WHERE send.lead_id = l.id)
          THEN 'call'
          ELSE 'text'
        END AS outreach_channel,
        MAX(la.created_at) as last_engagement_at
      FROM leads l
      LEFT JOIN lead_activity la
        ON la.lead_id = l.id
       AND la.action IN ('click_tracked', 'reply_received', 'calendar_clicked')
       AND NOT EXISTS (
         SELECT 1 FROM lead_activity undo
         WHERE undo.action = 'undo'
           AND json_extract(undo.meta, '$.undid_activity_id') = la.id
       )
      WHERE l.deleted_at IS NULL
        AND l.status IN ('cold', 'contacted')
        AND l.enrichment_status = 'enriched'
        AND l.has_website = 0
        AND l.pipeline_status = 'engaged'
        AND NOT EXISTS (
          SELECT 1
          FROM lead_activity called
          WHERE called.lead_id = l.id
            AND called.action = 'called'
            AND datetime(called.created_at) >= datetime(COALESCE((
              SELECT MAX(c2.created_at)
              FROM lead_activity c2
              WHERE c2.lead_id = l.id
                AND c2.action IN ('click_tracked', 'reply_received', 'calendar_clicked')
                AND NOT EXISTS (
                  SELECT 1 FROM lead_activity undo
                  WHERE undo.action = 'undo'
                    AND json_extract(undo.meta, '$.undid_activity_id') = c2.id
                )
            ), '1970-01-01'))
        )
      GROUP BY l.id
      ORDER BY l.engagement_score DESC, datetime(COALESCE(last_engagement_at, l.pipeline_last_action_at, l.updated_at)) DESC
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
      engagement_score: number;
      engagement_grade: string;
      engagement_reasons: string | null;
      pipeline_last_action_at: string | null;
      outreach_channel: 'text' | 'call';
      last_engagement_at: string | null;
    }>(),
    // The current automated pipeline sends through the SMS composer. Facebook
    // needs explicit channel logging before it can have real numbers here.
    funnelFor(week.monday, week.sunday),
    funnelFor(previousWeek.monday, previousWeek.sunday),
    effectivenessFor(engagementStart, engagementEnd),
    effectivenessFor(previousEngagementStart, previousEngagementEnd),
  ]);

  currentActivity.sitesCreated = siteReadyRow?.n ?? 0;

  return c.json({
    week,
    previousWeek,
    hero: {
      hotLeadsReadyToCall: (hotLeads.results ?? []).length,
      meetingsBookedThisWeek: current.booked,
      activeLeadsInPipeline: activeLeadsRow?.n ?? 0,
    },
    funnel: {
      current,
      previous,
      trends: {
        tapRate: delta(current.tapRate, previous.tapRate),
        engagementRate: delta(current.engagementRate, previous.engagementRate),
        bookRate: delta(current.bookRate, previous.bookRate),
      },
    },
    effectiveness: {
      range: engagementRange,
      current: effectivenessCurrent,
      previous: effectivenessPrevious,
      trends: {
        engagementByTouch: {
          intro: delta(
            effectivenessCurrent.engagementByTouch.intro.rate,
            effectivenessPrevious.engagementByTouch.intro.rate,
          ),
          reminder: delta(
            effectivenessCurrent.engagementByTouch.reminder.rate,
            effectivenessPrevious.engagementByTouch.reminder.rate,
          ),
          finalNudge: delta(
            effectivenessCurrent.engagementByTouch.finalNudge.rate,
            effectivenessPrevious.engagementByTouch.finalNudge.rate,
          ),
        },
        calendarBookingRate: delta(
          effectivenessCurrent.calendarBookingRate,
          effectivenessPrevious.calendarBookingRate,
        ),
      },
    },
    activity: {
      current: currentActivity,
      previous: previousActivity,
      trends: {
        sitesCreated: countDelta(currentActivity.sitesCreated, previousActivity.sitesCreated),
        introTextsSent: countDelta(currentActivity.introTextsSent, previousActivity.introTextsSent),
        followUpsSent: countDelta(currentActivity.followUpsSent, previousActivity.followUpsSent),
        engagedLeads: countDelta(currentActivity.engagedLeads, previousActivity.engagedLeads),
        totalVisits: countDelta(currentActivity.totalVisits, previousActivity.totalVisits),
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
