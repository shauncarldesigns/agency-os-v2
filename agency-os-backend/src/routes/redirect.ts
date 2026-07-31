// Public click-tracker redirect for the Automated Pipeline.
//
// Layer 1 of the two-layer engagement tracking (Layer 2 is Clarity's
// on-site data). Every intro/follow-up text points at this URL instead
// of the raw landingsite URL — a click here is the trustworthy signal
// that the recipient actually opened the link, independent of whether
// Clarity is set up on the destination site.
//
// Mounts at the app root (NOT under /api/*) so the auth middleware
// doesn't reject the recipient's browser request.

import { Hono } from 'hono';
import type { Env, Lead } from '../types';
import { log } from '../utils/errors';

export const redirectRouter = new Hono<{ Bindings: Env }>();
const CALENDAR_URL =
  'https://shauncarldesigns397463.hbportal.co/public/69d52364c8dc9c00078c64b6';

interface RequestCfSignals {
  country?: string;
  region?: string;
  regionCode?: string;
  city?: string;
  timezone?: string;
  asn?: number;
  asOrganization?: string;
  colo?: string;
  botManagement?: {
    score?: number;
    verifiedBot?: boolean;
  };
}

interface ClickAssessment {
  classification: 'plausible' | 'suspicious' | 'bot';
  confidence: number;
  reasons: string[];
  uaClass: 'ios' | 'android' | 'mobile' | 'desktop';
  browserHeadersPresent: boolean;
  cf: RequestCfSignals;
  botScore: number | null;
  verifiedBot: boolean | null;
}

const BOT_USER_AGENT = /bot|crawler|spider|preview|facebookexternalhit|slackbot|discordbot|twitterbot|linkedinbot|googleimageproxy|safelinks|urlscan|curl|wget|python|axios|go-http-client|headlesschrome/i;
const CLOUD_NETWORK = /amazon|aws|google cloud|microsoft azure|digitalocean|linode|vultr|ovh|hetzner|oracle cloud|data center|datacenter|hosting/i;

// GET /r/:lead_id
redirectRouter.get('/r/:lead_id', async (c) => {
  const raw = c.req.param('lead_id');
  const id = parseInt(raw, 10);
  if (isNaN(id) || id <= 0) return c.text('Invalid link', 400);
  const channel = c.req.query('channel') === 'email' ? 'email' : 'text';

  try {
    const lead = await c.env.DB.prepare(
      `SELECT id, site_url, pipeline_status, pipeline_sessions, state,
              click_confirmation_enabled_at
         FROM leads
        WHERE id = ? AND deleted_at IS NULL`,
    )
      .bind(id)
      .first<Pick<Lead, 'id'> & {
        site_url: string | null;
        pipeline_status: string;
        pipeline_sessions: number;
        state: string | null;
        click_confirmation_enabled_at: string | null;
      }>();

    if (!lead || !lead.site_url) return c.text('Link expired or not found', 404);
    const assessment = assessClick(c.req.raw, lead.state);
    const token = crypto.randomUUID();
    const result = await c.env.DB.prepare(`
      INSERT INTO outreach_clicks (
        lead_id, token, channel, classification, confidence, confirmation_required, risk_reasons,
        country, region, region_code, city, timezone, asn, as_organization,
        colo, ua_class, browser_headers_present, bot_score, verified_bot,
        expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '+24 hours'))
      RETURNING id
    `).bind(
      id,
      token,
      channel,
      assessment.classification,
      assessment.confidence,
      lead.click_confirmation_enabled_at ? 1 : 0,
      JSON.stringify(assessment.reasons),
      assessment.cf.country ?? null,
      assessment.cf.region ?? null,
      assessment.cf.regionCode ?? null,
      assessment.cf.city ?? null,
      assessment.cf.timezone ?? null,
      assessment.cf.asn ?? null,
      assessment.cf.asOrganization ?? null,
      assessment.cf.colo ?? null,
      assessment.uaClass,
      assessment.browserHeadersPresent ? 1 : 0,
      assessment.botScore,
      assessment.verifiedBot === null ? null : assessment.verifiedBot ? 1 : 0,
    ).first<{ id: number }>();

    await c.env.DB.prepare(`
      INSERT INTO lead_activity (lead_id, action, from_status, to_status, meta)
      VALUES (?, 'click_observed', ?, NULL, ?)
    `).bind(
      id,
      lead.pipeline_status,
      JSON.stringify({
        click_id: result?.id ?? null,
        channel,
        classification: assessment.classification,
        confidence: assessment.confidence,
        risk_reasons: assessment.reasons,
        country: assessment.cf.country ?? null,
        region: assessment.cf.regionCode ?? assessment.cf.region ?? null,
        city: assessment.cf.city ?? null,
        ua_class: assessment.uaClass,
      }),
    ).run();

    // Existing sites keep plausible-click behavior until their updated
    // tracking block confirms once. That first beacon self-enrolls the lead;
    // all later clicks require JavaScript confirmation. Bots and implausible
    // foreign traffic are screened immediately even during this rollout.
    if (!lead.click_confirmation_enabled_at && assessment.classification === 'plausible' && result?.id) {
      await promoteConfirmedClick(c.env, {
        id: result.id,
        lead_id: id,
        channel,
        confidence: assessment.confidence,
        risk_reasons: JSON.stringify(assessment.reasons),
        country: assessment.cf.country ?? null,
        region: assessment.cf.region ?? null,
        region_code: assessment.cf.regionCode ?? null,
        city: assessment.cf.city ?? null,
        ua_class: assessment.uaClass,
        pipeline_status: lead.pipeline_status,
      }, 'legacy_redirect');
    }

    log('info', 'redirect', `Click observed for lead ${id}`, {
      classification: assessment.classification,
      confidence: assessment.confidence,
      country: assessment.cf.country,
      region: assessment.cf.regionCode,
      ua_class: assessment.uaClass,
    });
    return c.redirect(trackedDestination(lead.site_url, channel, token), 302);
  } catch (err) {
    log('error', 'redirect', 'Click tracker failed', err);
    // Failing to log a click should NOT break the recipient's experience.
    // If we at least know the target URL, best-effort redirect anyway.
    try {
      const fallback = await c.env.DB.prepare('SELECT site_url FROM leads WHERE id = ?')
        .bind(id)
        .first<{ site_url: string | null }>();
      if (fallback?.site_url) return c.redirect(fallback.site_url, 302);
    } catch {
      // fall through
    }
    return c.text('Link temporarily unavailable', 500);
  }
});

// The destination site's tracking block calls this only when a unique token
// survives the redirect and JavaScript runs in a visible page. Raw operator
// visits have no token and therefore cannot promote a lead.
redirectRouter.post('/r/:lead_id/confirm', async (c) => {
  const id = parseInt(c.req.param('lead_id'), 10);
  const token = c.req.query('token');
  const signal = normalizeConfirmationSignal(c.req.query('signal'));
  if (isNaN(id) || id <= 0 || !token) return confirmationResponse('Invalid confirmation', 400);

  try {
    const click = await c.env.DB.prepare(`
      SELECT click.id, click.lead_id, click.channel, click.classification,
             click.confidence, click.confirmation_required, click.risk_reasons, click.country, click.region,
             click.region_code, click.city, click.ua_class, click.confirmed_at,
             click.expires_at, lead.site_url, lead.pipeline_status
      FROM outreach_clicks click
      JOIN leads lead ON lead.id = click.lead_id
      WHERE click.token = ? AND click.lead_id = ? AND lead.deleted_at IS NULL
    `).bind(token, id).first<{
      id: number;
      lead_id: number;
      channel: 'text' | 'email';
      classification: 'plausible' | 'suspicious' | 'bot';
      confidence: number;
      confirmation_required: number;
      risk_reasons: string | null;
      country: string | null;
      region: string | null;
      region_code: string | null;
      city: string | null;
      ua_class: string | null;
      confirmed_at: string | null;
      expires_at: string;
      site_url: string;
      pipeline_status: string;
    }>();
    if (!click) return confirmationResponse('Confirmation not found', 404);

    const origin = c.req.header('origin') ?? '';
    if (!matchesSiteOrigin(origin, click.site_url)) {
      return confirmationResponse('Origin rejected', 403);
    }
    if (new Date(normalizeSqlTimestamp(click.expires_at)).getTime() < Date.now()) {
      return confirmationResponse('Confirmation expired', 410, origin);
    }
    if (click.confirmed_at) return confirmationResponse(null, 204, origin);

    const updated = await c.env.DB.prepare(`
      UPDATE outreach_clicks
         SET confirmed_at = datetime('now'), confirmation_signal = ?,
             confirmation_origin = ?, updated_at = datetime('now')
       WHERE id = ? AND confirmed_at IS NULL
    `).bind(signal, origin, click.id).run();
    if ((updated.meta.changes ?? 0) === 0) return confirmationResponse(null, 204, origin);

    await c.env.DB.prepare(`
      UPDATE leads
         SET click_confirmation_enabled_at = COALESCE(click_confirmation_enabled_at, datetime('now')),
             updated_at = datetime('now')
       WHERE id = ?
    `).bind(id).run();

    // This was the first confirmation from a legacy site. Its plausible
    // redirect was already credited, so the beacon only enables strict
    // confirmation for future visits and must not count the session twice.
    if (click.confirmation_required === 0 && click.classification === 'plausible') {
      return confirmationResponse(null, 204, origin);
    }

    if (click.classification !== 'plausible') {
      await c.env.DB.prepare(`
        INSERT INTO lead_activity (lead_id, action, from_status, to_status, meta)
        VALUES (?, 'click_confirmation_screened', ?, NULL, ?)
      `).bind(
        id,
        click.pipeline_status,
        JSON.stringify({
          click_id: click.id,
          classification: click.classification,
          confidence: click.confidence,
          risk_reasons: safeJsonArray(click.risk_reasons),
          signal,
          country: click.country,
          region: click.region_code ?? click.region,
          city: click.city,
        }),
      ).run();
      log('info', 'redirect', `Confirmation screened for lead ${id}`, {
        click_id: click.id,
        classification: click.classification,
      });
      return confirmationResponse(null, 204, origin);
    }

    await promoteConfirmedClick(c.env, click, signal);
    return confirmationResponse(null, 204, origin);
  } catch (err) {
    log('error', 'redirect', 'Click confirmation failed', err);
    return confirmationResponse('Confirmation failed', 500);
  }
});

function trackedDestination(siteUrl: string, channel: 'email' | 'text', token: string): string {
  try {
    const url = new URL(siteUrl);
    if (channel === 'email') {
      url.searchParams.set('utm_source', 'email');
      url.searchParams.set('utm_medium', 'email');
    }
    url.searchParams.set('outreach_token', token);
    return url.toString();
  } catch {
    return siteUrl;
  }
}

function assessClick(request: Request, leadState: string | null): ClickAssessment {
  const cf = (request as Request & { cf?: RequestCfSignals }).cf ?? {};
  const ua = request.headers.get('user-agent') ?? '';
  const accept = request.headers.get('accept') ?? '';
  const fetchDest = request.headers.get('sec-fetch-dest') ?? '';
  const fetchMode = request.headers.get('sec-fetch-mode') ?? '';
  const browserHeadersPresent = accept.includes('text/html')
    && fetchDest === 'document'
    && fetchMode === 'navigate';
  const uaClass = /iPhone|iPad|iPod/i.test(ua)
    ? 'ios'
    : /Android/i.test(ua)
      ? 'android'
      : /Mobile/i.test(ua)
        ? 'mobile'
        : 'desktop';
  const botScore = typeof cf.botManagement?.score === 'number'
    ? cf.botManagement.score
    : null;
  const verifiedBot = typeof cf.botManagement?.verifiedBot === 'boolean'
    ? cf.botManagement.verifiedBot
    : null;
  const reasons: string[] = [];

  if (!ua) reasons.push('missing_user_agent');
  if (BOT_USER_AGENT.test(ua)) reasons.push('known_bot_user_agent');
  if (verifiedBot) reasons.push('cloudflare_verified_bot');
  if (botScore !== null && botScore < 30) reasons.push('cloudflare_likely_bot');
  if (!browserHeadersPresent) reasons.push('missing_browser_navigation_headers');
  if (cf.country && cf.country !== 'US') reasons.push('foreign_country');
  if (cf.country === 'US' && leadState && cf.regionCode && cf.regionCode !== leadState.toUpperCase()) {
    reasons.push('different_us_region');
  }
  const cloudNetwork = Boolean(cf.asOrganization && CLOUD_NETWORK.test(cf.asOrganization));
  if (cloudNetwork) reasons.push('cloud_hosting_network');

  const definiteBot = !ua
    || BOT_USER_AGENT.test(ua)
    || verifiedBot === true
    || (botScore !== null && botScore < 30);
  const suspicious = (cf.country !== undefined && cf.country !== 'US')
    || (cloudNetwork && !browserHeadersPresent);
  const classification = definiteBot ? 'bot' : suspicious ? 'suspicious' : 'plausible';
  let confidence = classification === 'bot' ? 0 : classification === 'suspicious' ? 20 : 70;
  if (classification === 'plausible' && browserHeadersPresent) confidence += 10;
  if (
    classification === 'plausible'
    && cf.country === 'US'
    && leadState
    && cf.regionCode === leadState.toUpperCase()
  ) confidence += 10;
  if (classification === 'plausible' && botScore !== null && botScore >= 60) confidence += 5;

  return {
    classification,
    confidence: Math.min(95, confidence),
    reasons,
    uaClass,
    browserHeadersPresent,
    cf,
    botScore,
    verifiedBot,
  };
}

async function promoteConfirmedClick(
  env: Env,
  click: {
    id: number;
    lead_id: number;
    channel: 'text' | 'email';
    confidence: number;
    risk_reasons: string | null;
    country: string | null;
    region: string | null;
    region_code: string | null;
    city: string | null;
    ua_class: string | null;
    pipeline_status: string;
  },
  signal: string,
): Promise<void> {
  const reply = await env.DB.prepare(`
    SELECT 1 AS found
    FROM lead_activity activity
    WHERE activity.lead_id = ? AND activity.action = 'reply_received'
      AND NOT EXISTS (
        SELECT 1 FROM lead_activity undo
        WHERE undo.action = 'undo'
          AND json_extract(undo.meta, '$.undid_activity_id') = activity.id
      )
    LIMIT 1
  `).bind(click.lead_id).first<{ found: number }>();
  const clickFloor = reply ? 55 : 40;
  const clickReason = reply
    ? '+15 confirmed site visit after replying'
    : click.channel === 'email'
      ? '+40 confirmed tracked email visit'
      : '+40 confirmed tracked text visit';
  const shouldPromote = click.pipeline_status === 'sent_no_reply';
  const nextStatus = shouldPromote ? 'engaged' : click.pipeline_status;

  await env.DB.prepare(`
    UPDATE leads
       SET pipeline_sessions = pipeline_sessions + 1,
           pipeline_status = ?,
           engagement_score = MAX(engagement_score, ?),
           engagement_grade = CASE
             WHEN MAX(engagement_score, ?) >= 90 THEN 'hot'
             WHEN MAX(engagement_score, ?) >= 70 THEN 'walkthrough'
             WHEN MAX(engagement_score, ?) >= 40 THEN 'follow_up'
             ELSE 'nurture'
           END,
           engagement_reasons = CASE
             WHEN COALESCE(engagement_reasons, '') LIKE '%confirmed tracked%visit%'
               THEN engagement_reasons
             WHEN json_valid(engagement_reasons)
               THEN json_insert(engagement_reasons, '$[#]', ?)
             ELSE json_array(?)
           END,
           pipeline_last_action_at = datetime('now'), updated_at = datetime('now')
     WHERE id = ?
  `).bind(
    nextStatus,
    clickFloor,
    clickFloor,
    clickFloor,
    clickFloor,
    clickReason,
    clickReason,
    click.lead_id,
  ).run();

  await env.DB.prepare(`
    UPDATE email_automations
       SET status = 'completed', current_step = 'complete', branch = 'demo_clicked',
           completed_at = datetime('now'), next_run_at = NULL,
           processing_at = NULL, updated_at = datetime('now')
     WHERE lead_id = ? AND status IN ('active', 'paused')
  `).bind(click.lead_id).run();

  if (click.channel === 'email') {
    const latestSend = await env.DB.prepare(`
      SELECT id FROM email_sends WHERE lead_id = ? ORDER BY id DESC LIMIT 1
    `).bind(click.lead_id).first<{ id: number }>();
    if (latestSend) {
      const clickedAt = new Date().toISOString();
      await env.DB.batch([
        env.DB.prepare(`
          UPDATE email_sends
             SET clicked_at = COALESCE(clicked_at, ?),
                 status = CASE
                   WHEN status IN ('bounced', 'complained', 'suppressed', 'failed') THEN status
                   ELSE 'clicked'
                 END,
                 updated_at = datetime('now')
           WHERE id = ?
        `).bind(clickedAt, latestSend.id),
        env.DB.prepare(`
          INSERT OR IGNORE INTO email_events (
            email_send_id, event_key, event_type, event_at, payload
          ) VALUES (?, ?, 'first_party.clicked', ?, ?)
        `).bind(
          latestSend.id,
          `confirmation:${click.id}:clicked`,
          clickedAt,
          JSON.stringify({ channel: click.channel, ua_class: click.ua_class, signal }),
        ),
      ]);
    }
  }

  await env.DB.prepare(`
    INSERT INTO lead_activity (lead_id, action, from_status, to_status, meta)
    VALUES (?, 'click_tracked', ?, ?, ?)
  `).bind(
    click.lead_id,
    click.pipeline_status,
    shouldPromote ? nextStatus : null,
    JSON.stringify({
      click_id: click.id,
      channel: click.channel,
      confirmation_signal: signal,
      confidence: click.confidence,
      risk_reasons: safeJsonArray(click.risk_reasons),
      country: click.country,
      region: click.region_code ?? click.region,
      city: click.city,
      ua_class: click.ua_class,
    }),
  ).run();

  log('info', 'redirect', `Click confirmed for lead ${click.lead_id}`, {
    click_id: click.id,
    promoted: shouldPromote,
    country: click.country,
    region: click.region_code,
    ua_class: click.ua_class,
  });
}

function matchesSiteOrigin(origin: string, siteUrl: string): boolean {
  if (!origin) return false;
  try {
    return new URL(origin).origin === new URL(siteUrl).origin;
  } catch {
    return false;
  }
}

function normalizeConfirmationSignal(value: string | undefined): string {
  return value === 'interaction' ? 'interaction' : 'visible_2s';
}

function safeJsonArray(value: string | null): unknown[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function normalizeSqlTimestamp(value: string): string {
  return /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(value)
    ? `${value.replace(' ', 'T')}Z`
    : value;
}

function confirmationResponse(message: string | null, status: number, origin?: string): Response {
  const headers = new Headers({ 'Cache-Control': 'no-store' });
  if (origin) {
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Vary', 'Origin');
  }
  return new Response(status === 204 ? null : message ?? '', { status, headers });
}

// GET /book/:lead_id — records scheduling intent, then forwards to the
// agency's public HoneyBook calendar. This is deliberately separate from
// website sessions/Clarity: opening a calendar is an 80-point intent floor,
// not a site visit or confirmed booking.
redirectRouter.get('/book/:lead_id', async (c) => {
  const id = parseInt(c.req.param('lead_id'), 10);
  if (isNaN(id) || id <= 0) return c.redirect(CALENDAR_URL, 302);

  try {
    const lead = await c.env.DB.prepare(
      `SELECT id, pipeline_status
         FROM leads
        WHERE id = ? AND deleted_at IS NULL`,
    ).bind(id).first<{ id: number; pipeline_status: string }>();
    if (!lead) return c.redirect(CALENDAR_URL, 302);

    const nextStatus =
      lead.pipeline_status === 'sent_no_reply' ? 'engaged' : lead.pipeline_status;
    const reason = '+80 opened scheduling calendar';
    await c.env.DB.prepare(
      `UPDATE leads
          SET pipeline_status = ?,
              engagement_score = MAX(engagement_score, 80),
              engagement_grade = CASE
                WHEN MAX(engagement_score, 80) >= 90 THEN 'hot'
                ELSE 'walkthrough'
              END,
              engagement_reasons = CASE
                WHEN COALESCE(engagement_reasons, '') LIKE '%opened scheduling calendar%'
                  THEN engagement_reasons
                WHEN json_valid(engagement_reasons)
                  THEN json_insert(engagement_reasons, '$[#]', ?)
                ELSE json_array(?)
              END,
              pipeline_last_action_at = datetime('now'),
              updated_at = datetime('now')
        WHERE id = ?`,
    ).bind(nextStatus, reason, reason, id).run();

    await c.env.DB.prepare(
      `INSERT INTO lead_activity (lead_id, action, from_status, to_status, meta)
       VALUES (?, 'calendar_clicked', ?, ?, ?)`,
    ).bind(
      id,
      lead.pipeline_status,
      nextStatus !== lead.pipeline_status ? nextStatus : null,
      JSON.stringify({ destination: 'honeybook' }),
    ).run();

    log('info', 'redirect', `Calendar click tracked for lead ${id}`, {
      promoted: nextStatus !== lead.pipeline_status,
    });
  } catch (err) {
    log('error', 'redirect', 'Calendar click tracker failed', err);
  }
  return c.redirect(CALENDAR_URL, 302);
});
