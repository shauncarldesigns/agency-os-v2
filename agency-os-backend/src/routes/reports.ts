import { Hono } from 'hono';
import type { Env, Project } from '../types';
import { badRequest, notFound, serverError, log } from '../utils/errors';
import { querySearchAnalytics, periodRange, previousPeriod, type GscRow } from '../services/gsc';
import { getPageSpeedReport } from '../services/pagespeed';
import { getZoneAnalytics } from '../services/cloudflare';
import { sendEmail } from '../services/email';
import { callClaude } from '../services/claude';
import { buildExecSummaryPrompt } from '../prompts/execSummary';

export const reportsRouter = new Hono<{ Bindings: Env }>();

interface ReportSnapshot {
  id: number;
  project_id: number;
  period: string;
  impressions: number | null;
  clicks: number | null;
  avg_position: number | null;
  ctr: number | null;
  pagespeed_desktop: number | null;
  pagespeed_mobile: number | null;
  visitors: number | null;
  pageviews: number | null;
  top_keywords: string | null;
  top_pages: string | null;
  exec_summary: string | null;
  created_at: string;
}

interface KeywordWin {
  query: string;
  previousPosition: number | null;
  currentPosition: number;
  delta: number | string;
  impressions: number;
  clicks: number;
}

// GET /api/reports/:projectId/summary?period=YYYY-MM
// Returns the cached snapshot + a previous-period snapshot for MoM comparison + keyword wins.
reportsRouter.get('/:projectId/summary', async (c) => {
  const projectId = parseInt(c.req.param('projectId'), 10);
  if (isNaN(projectId)) return c.json(badRequest('Invalid projectId'), 400);

  const period = c.req.query('period') ?? defaultPeriod();
  if (!/^\d{4}-\d{2}$/.test(period)) return c.json(badRequest('period must be YYYY-MM'), 400);

  const project = await c.env.DB.prepare('SELECT * FROM projects WHERE id = ?').bind(projectId).first<Project>();
  if (!project) return c.json(notFound('Project'), 404);

  const current = await c.env.DB
    .prepare('SELECT * FROM seo_snapshots WHERE project_id = ? AND period = ?')
    .bind(projectId, period).first<ReportSnapshot>();

  const prevPeriod = previousPeriod(period);
  const previous = await c.env.DB
    .prepare('SELECT * FROM seo_snapshots WHERE project_id = ? AND period = ?')
    .bind(projectId, prevPeriod).first<ReportSnapshot>();

  // Pages built within this period
  const { startDate, endDate } = periodRange(period);
  const pagesBuilt = await c.env.DB
    .prepare("SELECT type, service, city, slug, built_at FROM pages WHERE project_id = ? AND status = 'built' AND built_at >= ? AND built_at <= ? ORDER BY built_at ASC")
    .bind(projectId, startDate, `${endDate}T23:59:59`).all();

  // Keyword wins: compare current's top_keywords with previous's
  const currentKw = parseKeywords(current?.top_keywords);
  const previousKw = parseKeywords(previous?.top_keywords);
  const wins: KeywordWin[] = [];
  for (const k of currentKw.slice(0, 30)) {
    const prevK = previousKw.find(p => p.query === k.query);
    const currentPosition = k.position;
    const previousPosition = prevK?.position ?? null;
    let delta: number | string;
    if (previousPosition === null) delta = 'NEW';
    else delta = previousPosition - currentPosition; // positive = improved
    wins.push({
      query: k.query,
      previousPosition: previousPosition !== null ? Number(previousPosition.toFixed(1)) : null,
      currentPosition: Number(currentPosition.toFixed(1)),
      delta,
      impressions: k.impressions,
      clicks: k.clicks,
    });
  }
  // Sort: NEW first, then by largest improvement
  wins.sort((a, b) => {
    if (a.delta === 'NEW' && b.delta !== 'NEW') return -1;
    if (b.delta === 'NEW' && a.delta !== 'NEW') return 1;
    if (typeof a.delta === 'number' && typeof b.delta === 'number') return b.delta - a.delta;
    return 0;
  });

  return c.json({
    project: {
      id: project.id,
      name: project.business_name,
      city: project.city,
      state: project.state,
      tier: project.tier,
      client_email: project.client_email,
      custom_domain: project.custom_domain,
      landingsite_url: project.landingsite_url,
    },
    period,
    previousPeriod: prevPeriod,
    current,
    previous,
    pagesBuilt: pagesBuilt.results,
    keywordWins: wins.slice(0, 10),
  });
});

// POST /api/reports/:projectId/refresh — pull fresh GSC + PageSpeed + CF data for the *current* period
reportsRouter.post('/:projectId/refresh', async (c) => {
  const projectId = parseInt(c.req.param('projectId'), 10);
  if (isNaN(projectId)) return c.json(badRequest('Invalid projectId'), 400);

  const project = await c.env.DB.prepare('SELECT * FROM projects WHERE id = ?').bind(projectId).first<Project>();
  if (!project) return c.json(notFound('Project'), 404);

  const period = c.req.query('period') ?? currentPeriod();
  try {
    const snapshot = await refreshSnapshot(c.env, project, period);
    return c.json({ snapshot });
  } catch (err) {
    log('error', 'reports', `refresh failed for project ${projectId}`, err);
    return c.json(serverError(`Refresh failed: ${(err as Error).message}`), 500);
  }
});

// POST /api/reports/:projectId/snapshot — finalize a snapshot for the period (also writes exec_summary via Claude)
reportsRouter.post('/:projectId/snapshot', async (c) => {
  const projectId = parseInt(c.req.param('projectId'), 10);
  if (isNaN(projectId)) return c.json(badRequest('Invalid projectId'), 400);

  const project = await c.env.DB.prepare('SELECT * FROM projects WHERE id = ?').bind(projectId).first<Project>();
  if (!project) return c.json(notFound('Project'), 404);

  const period = c.req.query('period') ?? currentPeriod();
  try {
    // Refresh data first, then write exec summary
    const snapshot = await refreshSnapshot(c.env, project, period);
    const summary = await generateExecSummary(c.env, project, period, snapshot);
    await c.env.DB.prepare(
      'UPDATE seo_snapshots SET exec_summary = ? WHERE project_id = ? AND period = ?'
    ).bind(summary, projectId, period).run();
    return c.json({ snapshot: { ...snapshot, exec_summary: summary } });
  } catch (err) {
    log('error', 'reports', `snapshot failed for project ${projectId}`, err);
    return c.json(serverError(`Snapshot failed: ${(err as Error).message}`), 500);
  }
});

// POST /api/reports/:projectId/export — returns the report as standalone HTML
// Body: { period, sections: ['summary', 'mom', 'keywords', 'pages-built', 'health', 'next-month'] }
reportsRouter.post('/:projectId/export', async (c) => {
  const projectId = parseInt(c.req.param('projectId'), 10);
  if (isNaN(projectId)) return c.json(badRequest('Invalid projectId'), 400);

  const body = await c.req.json().catch(() => ({})) as { period?: string; sections?: string[] };
  const period = body.period ?? currentPeriod();
  const sections = body.sections ?? ['summary', 'mom', 'keywords', 'pages-built', 'next-month'];

  const data = await fetchSummaryData(c.env, projectId, period);
  if (!data) return c.json(notFound('Project'), 404);

  const html = renderReportHtml(data, sections);
  return c.html(html);
});

// POST /api/reports/:projectId/email — send the report HTML to the client_email on file (or override)
reportsRouter.post('/:projectId/email', async (c) => {
  const projectId = parseInt(c.req.param('projectId'), 10);
  if (isNaN(projectId)) return c.json(badRequest('Invalid projectId'), 400);

  const body = await c.req.json().catch(() => ({})) as { period?: string; sections?: string[]; to?: string; from?: string };
  const period = body.period ?? currentPeriod();
  const sections = body.sections ?? ['summary', 'mom', 'keywords', 'pages-built', 'next-month'];

  const data = await fetchSummaryData(c.env, projectId, period);
  if (!data) return c.json(notFound('Project'), 404);

  const to = body.to ?? data.project.client_email;
  if (!to) return c.json(badRequest('No client email on file — set client_email on the project or pass {to}'), 400);

  const from = body.from ?? 'reports@scd-agency.com';
  const html = renderReportHtml(data, sections, { emailMode: true });

  try {
    const sendResult = await sendEmail(c.env.RESEND_API_KEY, {
      to, from,
      subject: `${data.project.name} — SEO Report ${formatPeriod(period)}`,
      html,
    });

    await c.env.DB.prepare(
      'INSERT INTO report_history (project_id, period, sent_to, sent_at) VALUES (?, ?, ?, datetime(\'now\'))'
    ).bind(projectId, period, to).run();

    return c.json({ ok: true, id: sendResult.id, to });
  } catch (err) {
    log('error', 'reports', `email failed for project ${projectId}`, err);
    return c.json(serverError(`Email failed: ${(err as Error).message}`), 500);
  }
});

// --- Internals ---

interface FullSummary {
  project: {
    id: number; name: string; city: string | null; state: string | null;
    tier: number; client_email: string | null;
    custom_domain: string | null; landingsite_url: string | null;
  };
  period: string;
  previousPeriod: string;
  current: ReportSnapshot | null;
  previous: ReportSnapshot | null;
  pagesBuilt: Array<Record<string, unknown>>;
  keywordWins: KeywordWin[];
}

async function fetchSummaryData(env: Env, projectId: number, period: string): Promise<FullSummary | null> {
  const project = await env.DB.prepare('SELECT * FROM projects WHERE id = ?').bind(projectId).first<Project>();
  if (!project) return null;

  const current = await env.DB
    .prepare('SELECT * FROM seo_snapshots WHERE project_id = ? AND period = ?')
    .bind(projectId, period).first<ReportSnapshot>();
  const prevPeriod = previousPeriod(period);
  const previous = await env.DB
    .prepare('SELECT * FROM seo_snapshots WHERE project_id = ? AND period = ?')
    .bind(projectId, prevPeriod).first<ReportSnapshot>();
  const { startDate, endDate } = periodRange(period);
  const pagesBuilt = await env.DB
    .prepare("SELECT type, service, city, slug, built_at FROM pages WHERE project_id = ? AND status = 'built' AND built_at >= ? AND built_at <= ? ORDER BY built_at ASC")
    .bind(projectId, startDate, `${endDate}T23:59:59`).all();

  const currentKw = parseKeywords(current?.top_keywords);
  const previousKw = parseKeywords(previous?.top_keywords);
  const wins: KeywordWin[] = currentKw.slice(0, 30).map(k => {
    const prevK = previousKw.find(p => p.query === k.query);
    const previousPosition = prevK?.position ?? null;
    const delta: number | string = previousPosition === null
      ? 'NEW'
      : previousPosition - k.position;
    return {
      query: k.query,
      previousPosition: previousPosition !== null ? Number(previousPosition.toFixed(1)) : null,
      currentPosition: Number(k.position.toFixed(1)),
      delta,
      impressions: k.impressions,
      clicks: k.clicks,
    };
  });
  wins.sort((a, b) => {
    if (a.delta === 'NEW' && b.delta !== 'NEW') return -1;
    if (b.delta === 'NEW' && a.delta !== 'NEW') return 1;
    if (typeof a.delta === 'number' && typeof b.delta === 'number') return b.delta - a.delta;
    return 0;
  });

  return {
    project: {
      id: project.id,
      name: project.business_name,
      city: project.city,
      state: project.state,
      tier: project.tier,
      client_email: project.client_email,
      custom_domain: project.custom_domain,
      landingsite_url: project.landingsite_url,
    },
    period,
    previousPeriod: prevPeriod,
    current: current ?? null,
    previous: previous ?? null,
    pagesBuilt: pagesBuilt.results as Array<Record<string, unknown>>,
    keywordWins: wins.slice(0, 10),
  };
}

async function refreshSnapshot(env: Env, project: Project, period: string): Promise<ReportSnapshot> {
  const { startDate, endDate } = periodRange(period);

  // GSC (only if property URL configured)
  let gscData: { impressions: number; clicks: number; avgPosition: number; ctr: number; rows: GscRow[] } | null = null;
  if (project.gsc_property_url) {
    try {
      gscData = await querySearchAnalytics(
        env.GOOGLE_OAUTH_CLIENT_ID,
        env.GOOGLE_OAUTH_CLIENT_SECRET,
        env.GOOGLE_OAUTH_REFRESH_TOKEN,
        project.gsc_property_url,
        startDate,
        endDate,
      );
    } catch (err) {
      log('warn', 'reports', `GSC fetch failed for ${project.id}`, err);
    }
  }

  // PageSpeed (only if site is up)
  const url = project.custom_domain ?? project.landingsite_url;
  let pagespeed: { mobile: number; desktop: number } | null = null;
  if (url) {
    try {
      pagespeed = await getPageSpeedReport(env.GOOGLE_PLACES_API_KEY, url);
    } catch (err) {
      log('warn', 'reports', `PageSpeed fetch failed for ${project.id}`, err);
    }
  }

  // CF Analytics (only if zone configured)
  let cf: { visitors: number; pageviews: number } | null = null;
  if (project.cf_zone_id) {
    try {
      const z = await getZoneAnalytics(env.CLOUDFLARE_API_TOKEN, project.cf_zone_id);
      cf = { visitors: z.visitors, pageviews: z.pageviews };
    } catch (err) {
      log('warn', 'reports', `CF fetch failed for ${project.id}`, err);
    }
  }

  // Top keywords + top pages from GSC rows (compact JSON for storage)
  const topKeywords = gscData?.rows
    ? gscData.rows
        .filter(r => r.query)
        .slice(0, 50)
        .map(r => ({ query: r.query, position: r.position, impressions: r.impressions, clicks: r.clicks }))
    : [];
  const topPages = gscData?.rows
    ? aggregateByPage(gscData.rows).slice(0, 25)
    : [];

  // Upsert snapshot
  await env.DB.prepare(`
    INSERT INTO seo_snapshots (
      project_id, period, impressions, clicks, avg_position, ctr,
      pagespeed_desktop, pagespeed_mobile, visitors, pageviews,
      top_keywords, top_pages
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(project_id, period) DO UPDATE SET
      impressions = excluded.impressions,
      clicks = excluded.clicks,
      avg_position = excluded.avg_position,
      ctr = excluded.ctr,
      pagespeed_desktop = excluded.pagespeed_desktop,
      pagespeed_mobile = excluded.pagespeed_mobile,
      visitors = excluded.visitors,
      pageviews = excluded.pageviews,
      top_keywords = excluded.top_keywords,
      top_pages = excluded.top_pages
  `).bind(
    project.id, period,
    gscData?.impressions ?? null,
    gscData?.clicks ?? null,
    gscData?.avgPosition ?? null,
    gscData?.ctr ?? null,
    pagespeed?.desktop ?? null,
    pagespeed?.mobile ?? null,
    cf?.visitors ?? null,
    cf?.pageviews ?? null,
    JSON.stringify(topKeywords),
    JSON.stringify(topPages),
  ).run();

  // Per-keyword tracking (for trend charts later)
  for (const kw of topKeywords.slice(0, 25)) {
    try {
      await env.DB.prepare(`
        INSERT INTO keyword_tracking (project_id, query, period, position, impressions, clicks, ctr)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(project_id, query, period) DO UPDATE SET
          position = excluded.position,
          impressions = excluded.impressions,
          clicks = excluded.clicks,
          ctr = excluded.ctr
      `).bind(
        project.id, kw.query, period,
        kw.position, kw.impressions, kw.clicks,
        kw.impressions > 0 ? kw.clicks / kw.impressions : 0,
      ).run();
    } catch (err) {
      log('warn', 'reports', `keyword_tracking upsert failed: ${kw.query}`, err);
    }
  }

  log('info', 'reports', `Snapshot refreshed for project ${project.id} period ${period}`, {
    impressions: gscData?.impressions, clicks: gscData?.clicks, mobilePsi: pagespeed?.mobile,
  });

  // Read back the row
  const fresh = await env.DB
    .prepare('SELECT * FROM seo_snapshots WHERE project_id = ? AND period = ?')
    .bind(project.id, period).first<ReportSnapshot>();
  if (!fresh) throw new Error('Snapshot disappeared after upsert');
  return fresh;
}

async function generateExecSummary(env: Env, project: Project, period: string, snapshot: ReportSnapshot): Promise<string> {
  const prevPeriod = previousPeriod(period);
  const prev = await env.DB
    .prepare('SELECT * FROM seo_snapshots WHERE project_id = ? AND period = ?')
    .bind(project.id, prevPeriod).first<ReportSnapshot>();

  const { startDate, endDate } = periodRange(period);
  const pagesBuilt = await env.DB
    .prepare("SELECT type, service, city FROM pages WHERE project_id = ? AND status = 'built' AND built_at >= ? AND built_at <= ?")
    .bind(project.id, startDate, `${endDate}T23:59:59`).all();

  const currentKw = parseKeywords(snapshot.top_keywords);
  const previousKw = parseKeywords(prev?.top_keywords ?? null);
  const topWins = currentKw.slice(0, 5).map(k => {
    const prevK = previousKw.find(p => p.query === k.query);
    return {
      query: k.query,
      previousPosition: prevK?.position ?? null,
      currentPosition: k.position,
    };
  });

  const prompt = buildExecSummaryPrompt({
    businessName: project.business_name,
    city: project.city,
    period: formatPeriod(period),
    current: {
      impressions: snapshot.impressions ?? 0,
      clicks: snapshot.clicks ?? 0,
      avgPosition: snapshot.avg_position ?? 0,
      ctr: snapshot.ctr ?? 0,
    },
    previous: prev ? {
      impressions: prev.impressions ?? 0,
      clicks: prev.clicks ?? 0,
      avgPosition: prev.avg_position ?? 0,
      ctr: prev.ctr ?? 0,
    } : null,
    topKeywordWins: topWins,
    pagesBuiltThisMonth: pagesBuilt.results as Array<{ service?: string; city?: string; type: string }>,
  });

  const summary = await callClaude(env.CLAUDE_API_KEY, prompt, { maxTokens: 600, temperature: 0.5 });
  return summary.trim();
}

// --- Helpers ---

interface ParsedKeyword { query: string; position: number; impressions: number; clicks: number }

function parseKeywords(raw: string | null | undefined): ParsedKeyword[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    if (!Array.isArray(v)) return [];
    return v as ParsedKeyword[];
  } catch { return []; }
}

function aggregateByPage(rows: GscRow[]): Array<{ page: string; impressions: number; clicks: number }> {
  const m = new Map<string, { impressions: number; clicks: number }>();
  for (const r of rows) {
    const cur = m.get(r.page) ?? { impressions: 0, clicks: 0 };
    cur.impressions += r.impressions;
    cur.clicks += r.clicks;
    m.set(r.page, cur);
  }
  return Array.from(m.entries())
    .map(([page, v]) => ({ page, ...v }))
    .sort((a, b) => b.impressions - a.impressions);
}

function defaultPeriod(): string {
  return previousPeriod(currentPeriod());
}

function currentPeriod(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function formatPeriod(period: string): string {
  const [y, m] = period.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', timeZone: 'UTC',
  });
}

// --- Standalone HTML report — printable to PDF via the browser ---

function renderReportHtml(data: FullSummary, sections: string[], opts: { emailMode?: boolean } = {}): string {
  const { project, period, current, previous, pagesBuilt, keywordWins } = data;
  const emailMode = opts.emailMode ?? false;

  const want = (s: string) => sections.includes(s);

  const fmtN = (n: number | null | undefined) => n == null ? '—' : n.toLocaleString();
  const fmtPos = (n: number | null | undefined) => n == null ? '—' : n.toFixed(1);
  const fmtPct = (n: number | null | undefined) => n == null ? '—' : `${(n * 100).toFixed(2)}%`;
  const deltaPct = (cur: number | null, prev: number | null) => {
    if (cur == null || prev == null || prev === 0) return null;
    return ((cur - prev) / prev) * 100;
  };
  const deltaPctText = (cur: number | null, prev: number | null) => {
    const d = deltaPct(cur, prev);
    if (d == null) return '';
    const arrow = d >= 0 ? '↑' : '↓';
    const color = d >= 0 ? '#0a8c5a' : '#c62a2a';
    return `<span style="color:${color}">${arrow} ${Math.abs(d).toFixed(1)}% vs ${formatPeriod(data.previousPeriod).replace(/ \d{4}/, '')}</span>`;
  };

  const summary = current?.exec_summary?.trim()
    ? escapeHtml(current.exec_summary)
    : `<em style="color:#888;">Executive summary not generated yet — run snapshot to fill this in.</em>`;

  const keywordRows = keywordWins.length > 0
    ? keywordWins.map(k => {
        const deltaLabel = k.delta === 'NEW'
          ? '<span style="color:#0a8c5a;font-weight:600;">NEW</span>'
          : typeof k.delta === 'number'
            ? (k.delta > 0
              ? `<span style="color:#0a8c5a;font-weight:600;">↑ ${k.delta.toFixed(0)}</span>`
              : k.delta < 0
                ? `<span style="color:#c62a2a;font-weight:600;">↓ ${Math.abs(k.delta).toFixed(0)}</span>`
                : '<span style="color:#888;">—</span>')
            : '';
        return `<li><span>${escapeHtml(k.query)}</span><span>${deltaLabel} → #${Math.round(k.currentPosition)}</span></li>`;
      }).join('')
    : '<li><em style="color:#888;">No keyword data for this period</em></li>';

  const pagesBuiltList = pagesBuilt.length > 0
    ? pagesBuilt.map(p => {
        const label = p.type === 'service-area' && p.service && p.city
          ? `${escapeHtml(String(p.service))} in ${escapeHtml(String(p.city))}, ${escapeHtml(project.state ?? '')}`
          : escapeHtml(String(p.type));
        const date = p.built_at ? new Date(String(p.built_at)).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—';
        return `<li><span>${label}</span><span style="color:#666;">${date}</span></li>`;
      }).join('')
    : '<li><em style="color:#888;">No pages built this period</em></li>';

  // Inline styles for portability (email-friendly)
  const styles = `
    body{font-family:'DM Sans','Helvetica Neue',Arial,sans-serif;background:${emailMode ? '#f5f5f5' : '#1a1a1a'};margin:0;padding:24px;color:#1a1a1a;}
    .pdf-preview{background:#fff;border-radius:6px;padding:32px;max-width:720px;margin:0 auto;color:#1a1a1a;line-height:1.5;box-shadow:0 4px 16px rgba(0,0,0,0.08);}
    .pdf-preview h1{font-family:'Bebas Neue','Helvetica Neue',sans-serif;font-size:1.8rem;letter-spacing:1px;color:#a78bfa;margin:0 0 4px;}
    .pdf-sub{font-size:0.78rem;color:#666;margin-bottom:18px;}
    .pdf-divider{height:1px;background:#e0e0e0;margin:18px 0;}
    .pdf-preview h2{font-size:0.86rem;font-weight:700;color:#1a1a1a;margin:0 0 10px;text-transform:uppercase;letter-spacing:1px;}
    .pdf-preview p{font-size:0.86rem;color:#333;margin:0 0 8px;}
    .pdf-stat-row{display:grid;grid-template-columns:repeat(2,1fr);gap:10px;margin-bottom:12px;}
    .pdf-stat{background:#f5f5f5;border-radius:4px;padding:10px 12px;}
    .pdf-stat-label{font-size:0.6rem;font-weight:700;letter-spacing:0.5px;color:#888;text-transform:uppercase;}
    .pdf-stat-val{font-family:'Bebas Neue','Helvetica Neue',sans-serif;font-size:1.4rem;color:#1a1a1a;line-height:1.2;}
    .pdf-stat-delta{font-size:0.66rem;}
    .pdf-preview ul{list-style:none;padding-left:0;margin:0;}
    .pdf-preview li{font-size:0.78rem;color:#333;padding:5px 0;display:flex;justify-content:space-between;border-bottom:1px solid #f0f0f0;}
    .pdf-preview li:last-child{border-bottom:none;}
    .pdf-foot{margin-top:24px;padding-top:12px;border-top:1px solid #e0e0e0;font-size:0.66rem;color:#999;text-align:center;}
    @media print{body{background:#fff;padding:0;}.pdf-preview{box-shadow:none;border-radius:0;max-width:none;}}
  `;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(project.name)} — SEO Report ${formatPeriod(period)}</title>
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>${styles}</style>
</head>
<body>
<div class="pdf-preview">
  <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:6px;">
    <div>
      <h1>${escapeHtml(project.name).toUpperCase()}</h1>
      <div class="pdf-sub">SEO Performance Report · ${formatPeriod(period)}</div>
    </div>
    <div style="font-size:0.6rem;color:#999;text-align:right;font-family:'Bebas Neue','Helvetica Neue',sans-serif;letter-spacing:1px;">
      SCD<br>
      <span style="font-size:0.55rem;color:#bbb;font-family:'DM Sans','Helvetica Neue',Arial,sans-serif;letter-spacing:0;">Shaun Carl Designs</span>
    </div>
  </div>
  <div class="pdf-divider"></div>

  ${want('summary') ? `
  <h2>Executive Summary</h2>
  <p>${summary}</p>
  <div class="pdf-divider"></div>
  ` : ''}

  ${want('mom') ? `
  <h2>Month-Over-Month Performance</h2>
  <div class="pdf-stat-row">
    <div class="pdf-stat">
      <div class="pdf-stat-label">Impressions</div>
      <div class="pdf-stat-val">${fmtN(current?.impressions)}</div>
      <div class="pdf-stat-delta">${deltaPctText(current?.impressions ?? null, previous?.impressions ?? null)}</div>
    </div>
    <div class="pdf-stat">
      <div class="pdf-stat-label">Clicks</div>
      <div class="pdf-stat-val">${fmtN(current?.clicks)}</div>
      <div class="pdf-stat-delta">${deltaPctText(current?.clicks ?? null, previous?.clicks ?? null)}</div>
    </div>
    <div class="pdf-stat">
      <div class="pdf-stat-label">Avg Position</div>
      <div class="pdf-stat-val">${fmtPos(current?.avg_position)}</div>
      <div class="pdf-stat-delta">${previous?.avg_position != null && current?.avg_position != null
        ? `<span style="color:${current.avg_position < previous.avg_position ? '#0a8c5a' : '#c62a2a'};">${current.avg_position < previous.avg_position ? '↑' : '↓'} ${Math.abs(previous.avg_position - current.avg_position).toFixed(1)} spots</span>`
        : ''}</div>
    </div>
    <div class="pdf-stat">
      <div class="pdf-stat-label">Click-Through Rate</div>
      <div class="pdf-stat-val">${fmtPct(current?.ctr)}</div>
      <div class="pdf-stat-delta">${deltaPctText(current?.ctr ?? null, previous?.ctr ?? null)}</div>
    </div>
  </div>
  <div class="pdf-divider"></div>
  ` : ''}

  ${want('keywords') ? `
  <h2>Top Keyword Wins</h2>
  <ul>${keywordRows}</ul>
  <div class="pdf-divider"></div>
  ` : ''}

  ${want('pages-built') ? `
  <h2>Pages Built This Month</h2>
  <ul>${pagesBuiltList}</ul>
  <div class="pdf-divider"></div>
  ` : ''}

  ${want('next-month') ? `
  <h2>Recommended for Next Month</h2>
  <ul>
    <li><span>Continue building service-area pages in cities with proven customer activity</span></li>
    <li><span>Monitor keyword positions and update underperforming pages</span></li>
    <li><span>Continue weekly Google Business Profile post cadence and review responses</span></li>
  </ul>
  ` : ''}

  <div class="pdf-foot">Prepared by Shaun Carl Designs · scd-agency.com · Generated ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</div>
</div>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Cron: monthly snapshot for all Tier 3 live projects (called from src/index.ts scheduled handler)
export async function refreshTier3Snapshots(env: Env): Promise<{ projectId: number; ok: boolean; error?: string }[]> {
  const period = previousPeriod(currentPeriod()); // last completed month
  const res = await env.DB
    .prepare("SELECT * FROM projects WHERE tier = 3 AND status = 'live'")
    .all();
  const out: Array<{ projectId: number; ok: boolean; error?: string }> = [];
  for (const p of res.results as unknown as Project[]) {
    try {
      const snap = await refreshSnapshot(env, p, period);
      const summary = await generateExecSummary(env, p, period, snap);
      await env.DB.prepare(
        'UPDATE seo_snapshots SET exec_summary = ? WHERE project_id = ? AND period = ?'
      ).bind(summary, p.id, period).run();
      out.push({ projectId: p.id, ok: true });
    } catch (err) {
      out.push({ projectId: p.id, ok: false, error: (err as Error).message });
      log('error', 'reports', `cron snapshot failed for ${p.id}`, err);
    }
  }
  return out;
}

// Cron: refresh PageSpeed for live Tier 3 sites (lighter — daily)
export async function refreshTier3PageSpeed(env: Env): Promise<void> {
  const res = await env.DB
    .prepare("SELECT id, custom_domain, landingsite_url FROM projects WHERE tier = 3 AND status = 'live' AND (custom_domain IS NOT NULL OR landingsite_url IS NOT NULL)")
    .all();
  for (const row of res.results as Array<{ id: number; custom_domain: string | null; landingsite_url: string | null }>) {
    const url = row.custom_domain ?? row.landingsite_url;
    if (!url) continue;
    try {
      const ps = await getPageSpeedReport(env.GOOGLE_PLACES_API_KEY, url);
      // Update the *current period* snapshot row's PageSpeed numbers, creating it if absent
      const period = currentPeriod();
      await env.DB.prepare(`
        INSERT INTO seo_snapshots (project_id, period, pagespeed_desktop, pagespeed_mobile)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(project_id, period) DO UPDATE SET
          pagespeed_desktop = excluded.pagespeed_desktop,
          pagespeed_mobile = excluded.pagespeed_mobile
      `).bind(row.id, period, ps.desktop, ps.mobile).run();
    } catch (err) {
      log('warn', 'reports', `daily PageSpeed failed for project ${row.id}`, err);
    }
  }
}
