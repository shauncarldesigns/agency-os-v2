import type { Env, Lead } from '../types';
import { log } from '../utils/errors';

const CLARITY_EXPORT_URL = 'https://www.clarity.ms/export-data/api/v1/project-live-insights';

export type EngagementGrade = 'hot' | 'walkthrough' | 'follow_up' | 'nurture';

interface LeadForClarity extends Pick<
  Lead,
  | 'id'
  | 'company'
  | 'site_url'
  | 'site_url_raw'
  | 'campaign_slug'
  | 'clarity_tag'
  | 'pipeline_sessions'
  | 'pipeline_status'
> {
  /** Authoritative app-owned opens recorded by /r/:lead_id. */
  tracked_clicks: number;
  /** Manual positive/neutral SMS reply recorded by the operator. */
  reply_received: number;
  /** Scheduling intent recorded by /book/:lead_id. */
  calendar_clicked: number;
  /** 1 while known test traffic is still inside Clarity's rolling window. */
  clarity_suppressed: number;
}

interface EngagementScore {
  score: number;
  grade: EngagementGrade;
  reasons: string[];
  visits: number;
  claritySessions: number;
  trackedClicks: number;
}

interface ClaritySyncResult {
  checked: number;
  matched: number;
  updated: number;
  skipped: number;
  error?: string;
}

function gradeFor(score: number): EngagementGrade {
  if (score >= 90) return 'hot';
  if (score >= 70) return 'walkthrough';
  if (score >= 40) return 'follow_up';
  return 'nurture';
}

function normalizeUrl(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    url.hash = '';
    return url.toString().toLowerCase();
  } catch {
    return raw.toLowerCase();
  }
}

function collectNumbers(value: unknown, out: Array<{ key: string; value: number }> = [], key = ''): Array<{ key: string; value: number }> {
  if (typeof value === 'number' && Number.isFinite(value)) {
    out.push({ key, value });
  } else if (typeof value === 'string') {
    const trimmed = value.trim();
    if (/^\d+(\.\d+)?$/.test(trimmed)) out.push({ key, value: Number(trimmed) });
  } else if (Array.isArray(value)) {
    for (const item of value) collectNumbers(item, out, key);
  } else if (value && typeof value === 'object') {
    for (const [nextKey, item] of Object.entries(value as Record<string, unknown>)) {
      collectNumbers(item, out, nextKey);
    }
  }
  return out;
}

function maxNumberMatching(payload: unknown, patterns: RegExp[]): number {
  const nums = collectNumbers(payload);
  let max = 0;
  for (const { key, value } of nums) {
    if (patterns.some((pattern) => pattern.test(key))) {
      max = Math.max(max, value);
    }
  }
  return max;
}

function collectTextValues(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') {
    out.push(value);
  } else if (Array.isArray(value)) {
    for (const item of value) collectTextValues(item, out);
  } else if (value && typeof value === 'object') {
    for (const item of Object.values(value as Record<string, unknown>)) {
      collectTextValues(item, out);
    }
  }
  return out;
}

function matchesLead(recordText: string, lead: LeadForClarity): boolean {
  const needles = [
    lead.clarity_tag,
    lead.campaign_slug,
    normalizeUrl(lead.site_url),
    normalizeUrl(lead.site_url_raw),
  ]
    .filter((value): value is string => !!value)
    .map((value) => value.toLowerCase());
  return needles.some((needle) => recordText.includes(needle));
}

/**
 * Clarity groups each metric into one top-level record whose `information`
 * array contains rows for every URL in the shared project. Matching the
 * top-level JSON and retaining the whole record leaks other clients' totals
 * into this lead. Keep only the individual URL rows that match this lead.
 */
function matchingRecordsForLead(records: unknown[], lead: LeadForClarity): unknown[] {
  const matching: unknown[] = [];
  for (const record of records) {
    if (!record || typeof record !== 'object' || Array.isArray(record)) {
      if (matchesLead(JSON.stringify(record).toLowerCase(), lead)) matching.push(record);
      continue;
    }

    const objectRecord = record as Record<string, unknown>;
    if (Array.isArray(objectRecord.information)) {
      const information = objectRecord.information.filter((row) =>
        matchesLead(JSON.stringify(row).toLowerCase(), lead),
      );
      if (information.length > 0) matching.push({ ...objectRecord, information });
      continue;
    }

    if (matchesLead(JSON.stringify(record).toLowerCase(), lead)) matching.push(record);
  }
  return matching;
}

function scoreLead(records: unknown[], lead: LeadForClarity): EngagementScore {
  // Search only response values. Searching serialized object keys makes the
  // structural key "information" look like a form interaction.
  const text = collectTextValues(records).join(' ').toLowerCase();
  const trackedClicks = lead.tracked_clicks ?? 0;
  const replied = lead.reply_received > 0;
  const calendarClicked = lead.calendar_clicked > 0;
  const claritySessions = Math.round(maxNumberMatching(records, [/^totalSessionCount$/i]));
  const visits = trackedClicks;
  const engagementSeconds = maxNumberMatching(records, [/engagement/i, /time/i, /duration/i]);
  const scrollDepth = maxNumberMatching(records, [/scroll/i, /depth/i]);
  const reasons: string[] = [];
  let score = 0;

  // Clarity is context, not identity. Do not score a shared-project URL row
  // until the app-owned text link proves this lead actually opened the site.
  if (trackedClicks === 0) {
    if (replied) {
      score = 40;
      reasons.push('+40 replied by text');
    }
    if (calendarClicked) {
      score = Math.max(score, 80);
      reasons.push('+80 opened scheduling calendar');
    }
    return {
      score,
      grade: gradeFor(score),
      reasons,
      visits,
      claritySessions,
      trackedClicks,
    };
  }

  score += 40;
  reasons.push('+40 clicked tracked text link');
  if (replied) {
    score += 15;
    reasons.push('+15 replied and opened site');
  }
  if (engagementSeconds >= 30) {
    score += 5;
    reasons.push('+5 stayed 30 sec');
  }
  if (engagementSeconds >= 120) {
    score += 10;
    reasons.push('+10 stayed 2 min');
  }
  if (scrollDepth >= 75) {
    score += 10;
    reasons.push('+10 scrolled 75%');
  }
  if (/services?/.test(text)) {
    score += 10;
    reasons.push('+10 viewed Services');
  }
  if (/reviews?|testimonials?/.test(text)) {
    score += 10;
    reasons.push('+10 viewed Reviews');
  }
  if (/\bfaq\b|frequently-asked/.test(text)) {
    score += 5;
    reasons.push('+5 viewed FAQ');
  }
  if (/contact|quote|estimate|book/.test(text)) {
    score += 15;
    reasons.push('+15 opened Contact');
  }
  if (/form|submit|started[_ -]?form/.test(text)) {
    score += 25;
    reasons.push('+25 started form');
  }
  if (trackedClicks > 1 || claritySessions > 1) {
    score += 20;
    reasons.push('+20 returned later');
  }
  if (calendarClicked) {
    score = Math.max(score, 80);
    reasons.push('+80 opened scheduling calendar');
  }

  score = Math.min(100, score);
  return { score, grade: gradeFor(score), reasons, visits, claritySessions, trackedClicks };
}

async function fetchClarityLiveInsights(env: Env): Promise<unknown[]> {
  if (!env.CLARITY_API_TOKEN) throw new Error('CLARITY_API_TOKEN is not configured');
  const url = new URL(CLARITY_EXPORT_URL);
  url.searchParams.set('numOfDays', '3');
  url.searchParams.set('dimension1', 'URL');

  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${env.CLARITY_API_TOKEN}`,
      'Content-Type': 'application/json',
    },
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const message =
      json && typeof json === 'object' && 'message' in json
        ? String((json as { message?: unknown }).message)
        : `Clarity export failed with HTTP ${res.status}`;
    throw new Error(message);
  }
  return Array.isArray(json) ? json : [json];
}

async function writeClarityActivity(db: D1Database, lead: LeadForClarity, score: EngagementScore): Promise<void> {
  await db.prepare(`
    INSERT INTO lead_activity (lead_id, action, from_status, to_status, meta)
    VALUES (?, 'clarity_synced', ?, ?, ?)
  `).bind(
    lead.id,
    lead.pipeline_status,
    score.score >= 40 && lead.pipeline_status === 'sent_no_reply' ? 'engaged' : null,
    JSON.stringify({
      score: score.score,
      grade: score.grade,
      visits: score.visits,
      tracked_clicks: score.trackedClicks,
      clarity_sessions_3d: score.claritySessions,
      reasons: score.reasons,
    }),
  ).run();
}

export async function syncClarityEngagement(env: Env): Promise<ClaritySyncResult> {
  if (!env.CLARITY_API_TOKEN) {
    return { checked: 0, matched: 0, updated: 0, skipped: 0, error: 'CLARITY_API_TOKEN is not configured' };
  }

  const leadsResult = await env.DB.prepare(`
    SELECT
      id,
      company,
      site_url,
      site_url_raw,
      campaign_slug,
      clarity_tag,
      pipeline_sessions,
      pipeline_status,
      (
        SELECT COUNT(*)
        FROM lead_activity
        WHERE lead_activity.lead_id = leads.id
          AND lead_activity.action = 'click_tracked'
      ) AS tracked_clicks,
      (
        SELECT COUNT(*)
        FROM lead_activity
        WHERE lead_activity.lead_id = leads.id
          AND lead_activity.action = 'reply_received'
          AND NOT EXISTS (
            SELECT 1
            FROM lead_activity AS undo_activity
            WHERE undo_activity.action = 'undo'
              AND json_extract(undo_activity.meta, '$.undid_activity_id') = lead_activity.id
          )
      ) AS reply_received,
      (
        SELECT COUNT(*)
        FROM lead_activity
        WHERE lead_activity.lead_id = leads.id
          AND lead_activity.action = 'calendar_clicked'
      ) AS calendar_clicked,
      CASE
        WHEN clarity_ignore_until IS NOT NULL
          AND clarity_ignore_until > datetime('now') THEN 1
        ELSE 0
      END AS clarity_suppressed
    FROM leads
    WHERE deleted_at IS NULL
      AND site_url IS NOT NULL
      AND pipeline_status NOT IN ('booked', 'archived')
    LIMIT 500
  `).all<LeadForClarity>();
  const leads = leadsResult.results ?? [];
  if (leads.length === 0) return { checked: 0, matched: 0, updated: 0, skipped: 0 };

  // Repair counters before calling Clarity. `pipeline_sessions` is the
  // trustworthy number of tracked outreach-link opens, never a rolling
  // shared-project Clarity aggregate.
  await env.DB.prepare(`
    WITH activity_flags AS (
      SELECT l.id,
             EXISTS (
               SELECT 1 FROM lead_activity
               WHERE lead_id = l.id AND action = 'click_tracked'
             ) AS has_click,
             EXISTS (
               SELECT 1
               FROM lead_activity AS reply_activity
               WHERE reply_activity.lead_id = l.id
                 AND reply_activity.action = 'reply_received'
                 AND NOT EXISTS (
                   SELECT 1
                   FROM lead_activity AS undo_activity
                   WHERE undo_activity.action = 'undo'
                     AND json_extract(undo_activity.meta, '$.undid_activity_id') = reply_activity.id
                 )
             ) AS has_reply,
             EXISTS (
               SELECT 1 FROM lead_activity
               WHERE lead_id = l.id AND action = 'calendar_clicked'
             ) AS has_calendar
      FROM leads AS l
      WHERE l.deleted_at IS NULL
        AND l.site_url IS NOT NULL
        AND l.pipeline_status NOT IN ('booked', 'archived')
    )
    UPDATE leads
    SET pipeline_sessions = (
          SELECT COUNT(*)
          FROM lead_activity
          WHERE lead_activity.lead_id = leads.id
            AND lead_activity.action = 'click_tracked'
        ),
        engagement_score = CASE
          WHEN (SELECT has_calendar FROM activity_flags WHERE id = leads.id) = 1 THEN 80
          WHEN (SELECT has_click FROM activity_flags WHERE id = leads.id) = 1
           AND (SELECT has_reply FROM activity_flags WHERE id = leads.id) = 1 THEN 55
          WHEN (SELECT has_click FROM activity_flags WHERE id = leads.id) = 1
            OR (SELECT has_reply FROM activity_flags WHERE id = leads.id) = 1 THEN 40
          ELSE 0
        END,
        engagement_grade = CASE
          WHEN (SELECT has_calendar FROM activity_flags WHERE id = leads.id) = 1 THEN 'walkthrough'
          WHEN (SELECT has_click FROM activity_flags WHERE id = leads.id) = 1
            OR (SELECT has_reply FROM activity_flags WHERE id = leads.id) = 1 THEN 'follow_up'
          ELSE 'nurture'
        END,
        engagement_reasons = CASE
          WHEN (SELECT has_calendar FROM activity_flags WHERE id = leads.id) = 1
           AND (SELECT has_click FROM activity_flags WHERE id = leads.id) = 1
           AND (SELECT has_reply FROM activity_flags WHERE id = leads.id) = 1
            THEN json_array('+40 clicked tracked text link', '+15 replied and opened site', '+80 opened scheduling calendar')
          WHEN (SELECT has_calendar FROM activity_flags WHERE id = leads.id) = 1
           AND (SELECT has_click FROM activity_flags WHERE id = leads.id) = 1
            THEN json_array('+40 clicked tracked text link', '+80 opened scheduling calendar')
          WHEN (SELECT has_calendar FROM activity_flags WHERE id = leads.id) = 1
           AND (SELECT has_reply FROM activity_flags WHERE id = leads.id) = 1
            THEN json_array('+40 replied by text', '+80 opened scheduling calendar')
          WHEN (SELECT has_calendar FROM activity_flags WHERE id = leads.id) = 1
            THEN json_array('+80 opened scheduling calendar')
          WHEN (SELECT has_click FROM activity_flags WHERE id = leads.id) = 1
           AND (SELECT has_reply FROM activity_flags WHERE id = leads.id) = 1
            THEN json_array('+40 clicked tracked text link', '+15 replied and opened site')
          WHEN (SELECT has_click FROM activity_flags WHERE id = leads.id) = 1
            THEN json_array('+40 clicked tracked text link')
          WHEN (SELECT has_reply FROM activity_flags WHERE id = leads.id) = 1
            THEN json_array('+40 replied by text')
          ELSE NULL
        END
    WHERE deleted_at IS NULL
      AND site_url IS NOT NULL
      AND pipeline_status NOT IN ('booked', 'archived')
  `).run();

  let records: unknown[];
  try {
    records = await fetchClarityLiveInsights(env);
  } catch (err) {
    const message = (err as Error).message;
    // A 429 is a project-wide temporary quota condition, not a problem with
    // every individual lead. Keep it in Worker logs instead of pinning the
    // same stale warning to every lead card.
    if (!/\b429\b/.test(message)) {
      await env.DB.prepare(`
        UPDATE leads
        SET clarity_last_error = ?, clarity_last_sync_at = datetime('now')
        WHERE deleted_at IS NULL AND site_url IS NOT NULL
      `).bind(message.slice(0, 500)).run();
    }
    throw err;
  }

  // The export itself succeeded, so any project-wide error is resolved even
  // for leads that have no matching URL row in this three-day window.
  await env.DB.prepare(`
    UPDATE leads
    SET clarity_last_error = NULL,
        clarity_last_sync_at = datetime('now')
    WHERE deleted_at IS NULL
      AND site_url IS NOT NULL
      AND pipeline_status NOT IN ('booked', 'archived')
  `).run();

  let matched = 0;
  let updated = 0;
  let skipped = 0;

  for (const lead of leads) {
    if (lead.clarity_suppressed === 1) {
      skipped++;
      continue;
    }
    const matching = matchingRecordsForLead(records, lead);
    if (matching.length === 0) {
      skipped++;
      continue;
    }

    matched++;
    const score = scoreLead(matching, lead);
    const shouldPromote = score.trackedClicks > 0 && lead.pipeline_status === 'sent_no_reply';
    await env.DB.prepare(`
      UPDATE leads
      SET pipeline_sessions = ?,
          pipeline_status = CASE WHEN ? = 1 THEN 'engaged' ELSE pipeline_status END,
          engagement_score = ?,
          engagement_grade = ?,
          engagement_reasons = ?,
          clarity_last_sync_at = datetime('now'),
          clarity_last_error = NULL,
          pipeline_last_action_at = CASE WHEN ? = 1 THEN datetime('now') ELSE pipeline_last_action_at END,
          updated_at = datetime('now')
      WHERE id = ?
    `).bind(
      score.trackedClicks,
      shouldPromote ? 1 : 0,
      score.score,
      score.grade,
      JSON.stringify(score.reasons),
      shouldPromote ? 1 : 0,
      lead.id,
    ).run();
    await writeClarityActivity(env.DB, lead, score);
    updated++;
  }

  log('info', 'clarity', 'Clarity engagement sync complete', { checked: leads.length, matched, updated, skipped });
  return { checked: leads.length, matched, updated, skipped };
}

export function buildClaritySnippet(env: Pick<Env, 'CLARITY_PROJECT_ID' | 'OUTREACH_PUBLIC_URL'>, lead: Pick<Lead, 'id' | 'company' | 'campaign_slug' | 'clarity_tag'>): string {
  const projectId = env.CLARITY_PROJECT_ID || 'xt0tg8n14n';
  const tag = lead.clarity_tag || `lead-${lead.id}`;
  const campaign = lead.campaign_slug || `lead-${lead.id}`;
  const outreachUrl = (env.OUTREACH_PUBLIC_URL || 'https://agency-os-v2-api.lively-morning-d9de.workers.dev').replace(/\/$/, '');
  return `<script type="text/javascript">
    (function(c,l,a,r,i,t,y){
        c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};
        t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;
        y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);
    })(window, document, "clarity", "script", "${projectId}");

    clarity("set", "lead", "${escapeJs(tag)}");
    clarity("set", "campaign", "${escapeJs(campaign)}");
    clarity("set", "company", "${escapeJs(lead.company)}");

    (function(){
        var url = new URL(window.location.href);
        var token = url.searchParams.get("outreach_token");
        if (!token) return;
        url.searchParams.delete("outreach_token");
        window.history.replaceState(window.history.state, "", url.toString());

        var sent = false;
        var endpoint = "${escapeJs(outreachUrl)}/r/${lead.id}/confirm";
        function confirm(signal){
            if (sent || document.visibilityState !== "visible") return;
            sent = true;
            var target = endpoint + "?token=" + encodeURIComponent(token) + "&signal=" + signal;
            if (navigator.sendBeacon) navigator.sendBeacon(target, "");
            else fetch(target, { method: "POST", mode: "cors", credentials: "omit", keepalive: true });
        }
        ["pointerdown", "touchstart", "keydown", "scroll"].forEach(function(eventName){
            window.addEventListener(eventName, function(){ confirm("interaction"); }, { once: true, passive: true });
        });
        window.setTimeout(function(){ confirm("visible_2s"); }, 2000);
    })();
</script>`;
}

function escapeJs(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, ' ');
}
