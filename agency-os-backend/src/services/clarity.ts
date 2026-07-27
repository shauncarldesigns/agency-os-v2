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
> {}

interface EngagementScore {
  score: number;
  grade: EngagementGrade;
  reasons: string[];
  visits: number;
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

function scoreLead(records: unknown[], lead: LeadForClarity): EngagementScore {
  const text = JSON.stringify(records).toLowerCase();
  const visits = Math.max(
    lead.pipeline_sessions ?? 0,
    Math.round(maxNumberMatching(records, [/traffic/i, /session/i, /visit/i, /count/i])),
  );
  const engagementSeconds = maxNumberMatching(records, [/engagement/i, /time/i, /duration/i]);
  const scrollDepth = maxNumberMatching(records, [/scroll/i, /depth/i]);
  const reasons: string[] = [];
  let score = 0;

  if (visits > 0) {
    score += 5;
    reasons.push('+5 opened demo');
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
  if (visits > 1) {
    score += 20;
    reasons.push('+20 returned later');
  }

  score = Math.min(100, score);
  return { score, grade: gradeFor(score), reasons, visits };
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
      reasons: score.reasons,
    }),
  ).run();
}

export async function syncClarityEngagement(env: Env): Promise<ClaritySyncResult> {
  if (!env.CLARITY_API_TOKEN) {
    return { checked: 0, matched: 0, updated: 0, skipped: 0, error: 'CLARITY_API_TOKEN is not configured' };
  }

  const leadsResult = await env.DB.prepare(`
    SELECT id, company, site_url, site_url_raw, campaign_slug, clarity_tag, pipeline_sessions, pipeline_status
    FROM leads
    WHERE deleted_at IS NULL
      AND site_url IS NOT NULL
      AND pipeline_status NOT IN ('booked', 'archived')
    LIMIT 500
  `).all<LeadForClarity>();
  const leads = leadsResult.results ?? [];
  if (leads.length === 0) return { checked: 0, matched: 0, updated: 0, skipped: 0 };

  let records: unknown[];
  try {
    records = await fetchClarityLiveInsights(env);
  } catch (err) {
    const message = (err as Error).message;
    await env.DB.prepare(`
      UPDATE leads
      SET clarity_last_error = ?, clarity_last_sync_at = datetime('now')
      WHERE deleted_at IS NULL AND site_url IS NOT NULL
    `).bind(message.slice(0, 500)).run();
    throw err;
  }

  let matched = 0;
  let updated = 0;
  let skipped = 0;
  const recordTexts = records.map((record) => ({
    record,
    text: JSON.stringify(record).toLowerCase(),
  }));

  for (const lead of leads) {
    const matching = recordTexts
      .filter(({ text }) => matchesLead(text, lead))
      .map(({ record }) => record);
    if (matching.length === 0) {
      skipped++;
      continue;
    }

    matched++;
    const score = scoreLead(matching, lead);
    const shouldPromote = score.score >= 40 && lead.pipeline_status === 'sent_no_reply';
    await env.DB.prepare(`
      UPDATE leads
      SET pipeline_sessions = MAX(pipeline_sessions, ?),
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
      score.visits,
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

export function buildClaritySnippet(env: Pick<Env, 'CLARITY_PROJECT_ID'>, lead: Pick<Lead, 'id' | 'company' | 'campaign_slug' | 'clarity_tag'>): string {
  const projectId = env.CLARITY_PROJECT_ID || 'xt0tg8n14n';
  const tag = lead.clarity_tag || `lead-${lead.id}`;
  const campaign = lead.campaign_slug || `lead-${lead.id}`;
  return `<script type="text/javascript">
    (function(c,l,a,r,i,t,y){
        c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};
        t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;
        y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);
    })(window, document, "clarity", "script", "${projectId}");

    clarity("set", "lead", "${escapeJs(tag)}");
    clarity("set", "campaign", "${escapeJs(campaign)}");
    clarity("set", "company", "${escapeJs(lead.company)}");
</script>`;
}

function escapeJs(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, ' ');
}
