import { Hono } from 'hono';
import type { Env } from '../types';
import { log, serverError } from '../utils/errors';
import { syncClarityEngagement } from '../services/clarity';

export const settingsRouter = new Hono<{ Bindings: Env }>();

interface SettingsRow {
  general_json: string;
  outreach_json: string;
  defaults_json: string;
  updated_at: string;
}

const DEFAULTS = {
  general: {
    agencyName: 'Shaun Carl Designs', operatorName: 'Shaun Gehrke',
    operatorEmail: 'info@shauncarldesigns.com', initials: 'SG',
    timezone: 'America/Chicago', currency: 'USD', dateFormat: 'MM/DD/YYYY',
    defaultServiceArea: '', appearance: 'system',
  },
  outreach: {
    sessionSize: 40, scoreFloor: 50,
    industryRotation: ['plumber', 'hvac', 'electrician', 'roofer', 'general_contractor'],
    geographicFilters: [] as string[], callingDays: ['tuesday', 'wednesday', 'thursday'],
    callingBlocks: ['morning', 'evening'], recallCooldownDays: 14,
    hotThreshold: 90, walkthroughThreshold: 70, followUpThreshold: 40,
    bookingUrl: '',
  },
  defaults: {
    tier1Mrr: 0, tier2Mrr: 79, tier3Mrr: 499,
    services: [] as string[], serviceAreas: [] as string[],
    reportSenderName: 'Shaun Gehrke', reportSenderEmail: 'info@shauncarldesigns.com',
    companyVoice: 'Specific, local, plainspoken, and evidence-led.',
    bannedPhrases: ['premier', 'trusted', 'leading', 'passionate'],
  },
};

function objectValue(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

function parseObject(raw: string): Record<string, unknown> {
  try { return objectValue(JSON.parse(raw)); } catch { return {}; }
}

async function readSettings(db: D1Database) {
  const row = await db.prepare(
    'SELECT general_json, outreach_json, defaults_json, updated_at FROM agency_settings WHERE id = 1',
  ).first<SettingsRow>();
  return {
    general: { ...DEFAULTS.general, ...parseObject(row?.general_json ?? '{}') },
    outreach: { ...DEFAULTS.outreach, ...parseObject(row?.outreach_json ?? '{}') },
    defaults: { ...DEFAULTS.defaults, ...parseObject(row?.defaults_json ?? '{}') },
    updatedAt: row?.updated_at ?? null,
  };
}

settingsRouter.get('/', async (c) => {
  try { return c.json({ settings: await readSettings(c.env.DB) }); }
  catch (err) {
    log('error', 'settings', 'GET /settings failed', err);
    return c.json(serverError(), 500);
  }
});

settingsRouter.put('/', async (c) => {
  try {
    const body = objectValue(await c.req.json().catch(() => ({})));
    const current = await readSettings(c.env.DB);
    const general = { ...current.general, ...objectValue(body.general) };
    const outreach = { ...current.outreach, ...objectValue(body.outreach) };
    const defaults = { ...current.defaults, ...objectValue(body.defaults) };

    const sessionSize = Number(outreach.sessionSize);
    const scoreFloor = Number(outreach.scoreFloor);
    if (!Number.isFinite(sessionSize) || sessionSize < 1 || sessionSize > 100) {
      return c.json({ error: 'Session size must be between 1 and 100' }, 400);
    }
    if (!Number.isFinite(scoreFloor) || scoreFloor < 0 || scoreFloor > 100) {
      return c.json({ error: 'Score floor must be between 0 and 100' }, 400);
    }
    if (typeof general.operatorEmail !== 'string' || !general.operatorEmail.includes('@')) {
      return c.json({ error: 'Enter a valid operator email' }, 400);
    }

    await c.env.DB.prepare(`
      INSERT INTO agency_settings (id, general_json, outreach_json, defaults_json, updated_at)
      VALUES (1, ?, ?, ?, datetime('now'))
      ON CONFLICT(id) DO UPDATE SET general_json=excluded.general_json,
        outreach_json=excluded.outreach_json, defaults_json=excluded.defaults_json,
        updated_at=datetime('now')
    `).bind(JSON.stringify(general), JSON.stringify(outreach), JSON.stringify(defaults)).run();
    return c.json({ settings: await readSettings(c.env.DB) });
  } catch (err) {
    log('error', 'settings', 'PUT /settings failed', err);
    return c.json(serverError(), 500);
  }
});

settingsRouter.get('/health', async (c) => {
  try {
    const [counts, clarity, automation, dns] = await Promise.all([
      c.env.DB.prepare(`SELECT
        (SELECT COUNT(*) FROM leads WHERE deleted_at IS NULL) AS leads,
        (SELECT COUNT(*) FROM projects) AS projects,
        (SELECT COUNT(*) FROM sessions) AS sessions`).first<{ leads: number; projects: number; sessions: number }>(),
      c.env.DB.prepare('SELECT MAX(clarity_last_sync_at) AS at FROM leads').first<{ at: string | null }>(),
      c.env.DB.prepare('SELECT MAX(updated_at) AS at FROM email_automations').first<{ at: string | null }>().catch(() => null),
      c.env.DB.prepare("SELECT COUNT(*) AS n FROM projects WHERE dns_status = 'pending'").first<{ n: number }>(),
    ]);
    const configured = (value: string | undefined) => Boolean(value?.trim());
    const integrations = [
      { id: 'anthropic', name: 'Anthropic', configured: configured(c.env.CLAUDE_API_KEY), detail: 'Briefs, review mining, and rebuttals' },
      { id: 'google', name: 'Google Places & PageSpeed', configured: configured(c.env.GOOGLE_PLACES_API_KEY), detail: 'Prospecting and performance data' },
      { id: 'gsc', name: 'Google Search Console', configured: configured(c.env.GOOGLE_OAUTH_REFRESH_TOKEN), detail: 'Client search reporting' },
      { id: 'outscraper', name: 'Outscraper', configured: configured(c.env.OUTSCRAPER_API_KEY), optional: true, detail: 'Extended Google review history' },
      { id: 'cloudflare', name: 'Cloudflare DNS', configured: configured(c.env.CLOUDFLARE_API_TOKEN) && configured(c.env.CLOUDFLARE_ACCOUNT_ID), detail: `${dns?.n ?? 0} zones awaiting delegation` },
      { id: 'clarity', name: 'Microsoft Clarity', configured: configured(c.env.CLARITY_API_TOKEN), optional: true, lastSuccessAt: clarity?.at ?? null, detail: 'Engagement context and scoring' },
      { id: 'resend', name: 'Resend', configured: configured(c.env.RESEND_API_KEY), detail: 'Outreach and report email' },
      { id: 'twilio', name: 'Twilio Lookup', configured: configured(c.env.TWILIO_ACCOUNT_SID) && configured(c.env.TWILIO_AUTH_TOKEN), optional: true, detail: 'Phone route classification' },
      { id: 'honeybook', name: 'HoneyBook', configured: true, detail: 'Booking embed configured in dashboard' },
    ];
    return c.json({
      status: 'ok', checkedAt: new Date().toISOString(), integrations,
      system: { database: 'connected', environment: c.env.ENV, counts: counts ?? { leads: 0, projects: 0, sessions: 0 }, lastAutomationAt: automation?.at ?? null },
    });
  } catch (err) {
    log('error', 'settings', 'GET /settings/health failed', err);
    return c.json(serverError(), 500);
  }
});

settingsRouter.post('/clarity-sync', async (c) => {
  try { return c.json(await syncClarityEngagement(c.env)); }
  catch (err) {
    log('error', 'settings', 'POST /settings/clarity-sync failed', err);
    return c.json(serverError(), 500);
  }
});
