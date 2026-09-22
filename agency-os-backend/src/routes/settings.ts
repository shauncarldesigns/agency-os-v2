import { Hono } from 'hono';
import type { Env } from '../types';
import { log, serverError } from '../utils/errors';
import { syncClarityEngagement } from '../services/clarity';
import { hasUsableGooglePlacesKey } from '../services/places';
import { isGoogleAdsConfigured } from '../services/googleAds';
import { INDUSTRY_SEARCH_CATALOG } from '../data/industrySearchCatalog';

export const settingsRouter = new Hono<{ Bindings: Env }>();

interface SettingsRow {
  general_json: string;
  outreach_json: string;
  defaults_json: string;
  discovery_json: string;
  research_json: string;
  updated_at: string;
}

export const HOME_SERVICE_INDUSTRIES = INDUSTRY_SEARCH_CATALOG.map((profile) => profile.industry);

const DEFAULTS = {
  general: {
    agencyName: 'Shaun Carl Designs', operatorName: 'Shaun Gehrke',
    operatorEmail: 'info@shauncarldesigns.com', operatorPhone: '+19208198098', initials: 'SG',
    timezone: 'America/Chicago', currency: 'USD', dateFormat: 'MM/DD/YYYY',
    defaultServiceArea: '', appearance: 'system',
  },
  outreach: {
    sessionSize: 40, scoreFloor: 50,
    industryRotation: ['plumber', 'hvac', 'electrician', 'roofer', 'general_contractor'],
    geographicFilters: [] as string[], callingDays: ['tuesday', 'wednesday', 'thursday'],
    callingBlocks: ['morning', 'evening'], recallCooldownDays: 14,
    hotThreshold: 90, walkthroughThreshold: 70, followUpThreshold: 40,
  },
  defaults: {
    tier1Mrr: 0, tier2Mrr: 79, tier3Mrr: 499,
    services: [] as string[], serviceAreas: [] as string[],
    reportSenderName: 'Shaun Gehrke', reportSenderEmail: 'info@shauncarldesigns.com',
    companyVoice: 'Specific, local, plainspoken, and evidence-led.',
    bannedPhrases: ['premier', 'trusted', 'leading', 'passionate'],
  },
  discovery: {
    enabled: false,
    websiteMode: 'no_website',
    phoneRequired: true,
    industries: ['Plumbing', 'HVAC', 'Electrical', 'Roofing', 'General Contracting'],
    industryProfiles: INDUSTRY_SEARCH_CATALOG,
    locations: ['Green Bay, WI', 'Appleton, WI'],
    locationGroups: [] as Array<{ name: string; enabled: boolean; locations: string[] }>,
    runDays: ['monday', 'wednesday', 'friday'],
    localRunHour: 8,
    maxCandidatesPerRun: 20,
    scoreFloor: 0,
    suppressionDays: 90,
    expirationDays: 30,
    maxActiveOutreach: 100,
  },
  research: {
    // Templates expand against the market's industry term and city. Keyword
    // phrasing may come from templates (or Claude in later phases); every
    // NUMBER attached to a keyword comes from the provider API.
    seedTemplates: [
      '{service} {city}',
      '{service} near me',
      'emergency {service} {city}',
      '{service} company {city}',
      'best {service} {city}',
      '24 hour {service}',
      '{service} repair {city}',
    ],
    industryTerms: {
      'Plumbing': 'plumber',
      'HVAC': 'hvac',
      'Electrical': 'electrician',
      'Roofing': 'roofer',
      'General Contracting': 'general contractor',
      'Landscaping': 'landscaper',
      'Painting': 'painter',
      'Flooring': 'flooring',
      'Concrete and Masonry': 'concrete contractor',
      'Siding': 'siding contractor',
      'Gutters': 'gutter cleaning',
      'Garage Doors': 'garage door repair',
      'Fencing': 'fence contractor',
      'Remodeling': 'remodeling contractor',
      'Kitchen and Bathroom Remodeling': 'bathroom remodeling',
      'Water Damage Restoration': 'water damage restoration',
      'Pest Control': 'pest control',
      'Tree Services': 'tree service',
      'Septic Services': 'septic service',
      'Drain and Sewer Services': 'drain cleaning',
      // Research-only industries (not in the Lead Finder discovery list).
      // Google's idea expansion surfaces the sibling phrasings ("auto body
      // shop", "dent repair") with volumes, so one seed term is enough.
      'Collision Repair': 'collision repair',
    } as Record<string, string>,
    mapPackKeywordCount: 3,
    mapPackResultLimit: 5,
    batchCap: 15,
    provider: 'google_ads',
  },
};

function objectValue(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

function parseObject(raw: string): Record<string, unknown> {
  try { return objectValue(JSON.parse(raw)); } catch { return {}; }
}

export async function readSettings(db: D1Database) {
  const row = await db.prepare(
    'SELECT general_json, outreach_json, defaults_json, discovery_json, research_json, updated_at FROM agency_settings WHERE id = 1',
  ).first<SettingsRow>();
  const storedResearch = parseObject(row?.research_json ?? '{}');
  // industryTerms needs a per-key merge: a saved settings blob would
  // otherwise shadow the whole default map and hide newly added industries.
  const research = {
    ...DEFAULTS.research,
    ...storedResearch,
    industryTerms: { ...DEFAULTS.research.industryTerms, ...objectValue(storedResearch.industryTerms) },
  };
  const storedDiscovery = parseObject(row?.discovery_json ?? '{}');
  const storedProfiles = Array.isArray(storedDiscovery.industryProfiles) ? storedDiscovery.industryProfiles : [];
  const profileMap = new Map(INDUSTRY_SEARCH_CATALOG.map((profile) => [profile.industry, profile]));
  for (const raw of storedProfiles) {
    const profile = objectValue(raw);
    if (typeof profile.industry === 'string' && Array.isArray(profile.keywords)) {
      profileMap.set(profile.industry, { industry: profile.industry, keywords: profile.keywords.filter((value): value is string => typeof value === 'string') });
    }
  }
  return {
    general: { ...DEFAULTS.general, ...parseObject(row?.general_json ?? '{}') },
    outreach: { ...DEFAULTS.outreach, ...parseObject(row?.outreach_json ?? '{}') },
    defaults: { ...DEFAULTS.defaults, ...parseObject(row?.defaults_json ?? '{}') },
    discovery: { ...DEFAULTS.discovery, ...storedDiscovery, industryProfiles: [...profileMap.values()] },
    research,
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
    const discovery = { ...current.discovery, ...objectValue(body.discovery) };
    const research = { ...current.research, ...objectValue(body.research) };

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
    const industries = Array.isArray(discovery.industries)
      ? [...new Set(discovery.industries.filter((value): value is string => typeof value === 'string').map((value) => value.trim()).filter(Boolean))]
      : [];
    const locations = Array.isArray(discovery.locations) ? discovery.locations.filter((value): value is string => typeof value === 'string' && value.trim().length > 0) : [];
    const locationGroups = Array.isArray(discovery.locationGroups) ? discovery.locationGroups.flatMap((raw) => {
      const group = objectValue(raw);
      const name = typeof group.name === 'string' ? group.name.trim() : '';
      const groupLocations = Array.isArray(group.locations)
        ? group.locations.filter((value): value is string => typeof value === 'string' && value.trim().length > 0).map((value) => value.trim())
        : [];
      return name && groupLocations.length ? [{ name, enabled: group.enabled !== false, locations: [...new Set(groupLocations)] }] : [];
    }) : [];
    const incomingProfiles = Array.isArray(discovery.industryProfiles) ? discovery.industryProfiles : [];
    const industryProfiles = industries.map((industry) => {
      const raw = incomingProfiles.find((value) => objectValue(value).industry === industry);
      const profile = objectValue(raw);
      const keywords = Array.isArray(profile.keywords)
        ? [...new Set(profile.keywords.filter((value): value is string => typeof value === 'string').map((value) => value.trim()).filter(Boolean))]
        : [];
      return { industry, keywords: keywords.length ? keywords.slice(0, 12) : [industry] };
    });
    if (industries.length === 0 || industries.some((industry) => industry.length > 80)) return c.json({ error: 'Lead Discovery needs at least one valid industry' }, 400);
    if ((locationGroups.length > 0 && !locationGroups.some((group) => group.enabled)) || (locationGroups.length === 0 && locations.length === 0)) {
      return c.json({ error: 'Lead Discovery needs at least one enabled search location' }, 400);
    }
    const maxCandidates = Number(discovery.maxCandidatesPerRun);
    const localRunHour = Number(discovery.localRunHour);
    const discoveryScoreFloor = Number(discovery.scoreFloor);
    const suppressionDays = Number(discovery.suppressionDays);
    const expirationDays = Number(discovery.expirationDays);
    const maxActiveOutreach = Number(discovery.maxActiveOutreach);
    const allowedRunDays = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'];
    const runDays = Array.isArray(discovery.runDays)
      ? discovery.runDays.filter((value): value is string => typeof value === 'string')
      : [];
    if (!Number.isFinite(maxCandidates) || maxCandidates < 1 || maxCandidates > 60) {
      return c.json({ error: 'Candidates per run must be between 1 and 60' }, 400);
    }
    if (!Number.isInteger(localRunHour) || localRunHour < 0 || localRunHour > 23) {
      return c.json({ error: 'Lead Discovery run hour must be between 0 and 23' }, 400);
    }
    if (!runDays.length || runDays.some((day) => !allowedRunDays.includes(day))) {
      return c.json({ error: 'Lead Discovery needs at least one weekday' }, 400);
    }
    if (!Number.isFinite(discoveryScoreFloor) || discoveryScoreFloor < 0 || discoveryScoreFloor > 100) {
      return c.json({ error: 'Lead Discovery score floor must be between 0 and 100' }, 400);
    }
    if (!Number.isInteger(suppressionDays) || suppressionDays < 1 || suppressionDays > 365) {
      return c.json({ error: 'Rejected suppression must be between 1 and 365 days' }, 400);
    }
    if (!Number.isInteger(expirationDays) || expirationDays < 1 || expirationDays > 180) {
      return c.json({ error: 'Unreviewed expiration must be between 1 and 180 days' }, 400);
    }
    if (!Number.isInteger(maxActiveOutreach) || maxActiveOutreach < 1 || maxActiveOutreach > 1000) {
      return c.json({ error: 'Maximum active outreach leads must be between 1 and 1000' }, 400);
    }
    discovery.websiteMode = 'no_website';
    discovery.industries = industries;
    discovery.industryProfiles = industryProfiles;
    discovery.locations = locations;
    discovery.locationGroups = locationGroups;
    discovery.runDays = runDays;
    discovery.localRunHour = localRunHour;
    discovery.scoreFloor = discoveryScoreFloor;
    discovery.suppressionDays = suppressionDays;
    discovery.expirationDays = expirationDays;
    discovery.maxActiveOutreach = maxActiveOutreach;

    // Market research config
    const seedTemplates = Array.isArray(research.seedTemplates)
      ? research.seedTemplates.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      : [];
    if (seedTemplates.length === 0) return c.json({ error: 'Research needs at least one keyword seed template' }, 400);
    const industryTermsRaw = objectValue(research.industryTerms);
    const industryTerms: Record<string, string> = {};
    for (const [key, value] of Object.entries(industryTermsRaw)) {
      if (typeof value === 'string' && value.trim()) industryTerms[key] = value.trim();
    }
    const mapPackKeywordCount = Number(research.mapPackKeywordCount);
    const mapPackResultLimit = Number(research.mapPackResultLimit);
    const batchCap = Number(research.batchCap);
    if (!Number.isInteger(mapPackKeywordCount) || mapPackKeywordCount < 1 || mapPackKeywordCount > 10) {
      return c.json({ error: 'Map pack keywords per market must be between 1 and 10' }, 400);
    }
    if (!Number.isInteger(mapPackResultLimit) || mapPackResultLimit < 3 || mapPackResultLimit > 20) {
      return c.json({ error: 'Map pack results per keyword must be between 3 and 20' }, 400);
    }
    // 15-market ceiling keeps a full run inside the Worker's 1000-subrequest
    // budget (~50 subrequests per market at the default 3 scrapes).
    if (!Number.isInteger(batchCap) || batchCap < 1 || batchCap > 15) {
      return c.json({ error: 'Research batch cap must be between 1 and 15 markets' }, 400);
    }
    if (research.provider !== 'google_ads' && research.provider !== 'dataforseo') {
      return c.json({ error: 'Keyword volume provider must be google_ads or dataforseo' }, 400);
    }
    research.seedTemplates = seedTemplates;
    research.industryTerms = industryTerms;
    research.mapPackKeywordCount = mapPackKeywordCount;
    research.mapPackResultLimit = mapPackResultLimit;
    research.batchCap = batchCap;

    await c.env.DB.prepare(`
      INSERT INTO agency_settings (id, general_json, outreach_json, defaults_json, discovery_json, research_json, updated_at)
      VALUES (1, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(id) DO UPDATE SET general_json=excluded.general_json,
        outreach_json=excluded.outreach_json, defaults_json=excluded.defaults_json,
        discovery_json=excluded.discovery_json,
        research_json=excluded.research_json,
        updated_at=datetime('now')
    `).bind(JSON.stringify(general), JSON.stringify(outreach), JSON.stringify(defaults), JSON.stringify(discovery), JSON.stringify(research)).run();
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
    // A developer token that is valid but not yet approved for Basic Access
    // fails identically to a bad credential from the operator's seat — the
    // most recent google_ads run's error detail is the disambiguator.
    // .catch handles the table not existing before the migration is applied.
    const latestAdsRun = await c.env.DB.prepare(
      "SELECT status, error_detail FROM research_runs WHERE provider = 'google_ads' ORDER BY started_at DESC, id DESC LIMIT 1",
    ).first<{ status: string; error_detail: string | null }>().catch(() => null);
    const adsConfigured = isGoogleAdsConfigured(c.env);
    const adsAccessPending = adsConfigured
      && latestAdsRun?.status === 'failed'
      && Boolean(latestAdsRun.error_detail?.includes('not yet approved'));
    const googleAdsDetail = !adsConfigured
      ? 'Needs GOOGLE_ADS_DEVELOPER_TOKEN, an adwords-scope GOOGLE_ADS_REFRESH_TOKEN, and GOOGLE_ADS_LOGIN_CUSTOMER_ID — the OAuth client is shared with Search Console unless overridden'
      : adsAccessPending
        ? 'Credentials are valid, but the developer token is still awaiting Basic Access approval from Google — real keyword data is unavailable until then'
        : 'Keyword volume and seasonality for market research';
    const integrations = [
      { id: 'anthropic', name: 'Anthropic', configured: configured(c.env.CLAUDE_API_KEY), detail: 'Briefs, review mining, and rebuttals' },
      { id: 'google', name: 'Google Places & PageSpeed', configured: hasUsableGooglePlacesKey(c.env.GOOGLE_PLACES_API_KEY), detail: hasUsableGooglePlacesKey(c.env.GOOGLE_PLACES_API_KEY) ? 'Prospecting and performance data' : 'A valid Google Places API key is required' },
      { id: 'gsc', name: 'Google Search Console', configured: configured(c.env.GOOGLE_OAUTH_REFRESH_TOKEN), detail: 'Client search reporting' },
      { id: 'google_ads', name: 'Google Ads', configured: adsConfigured && !adsAccessPending, optional: true, detail: googleAdsDetail },
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

settingsRouter.get('/activity', async (c) => {
  try {
    const requestedLimit = Number(c.req.query('limit') ?? 100);
    const limit = Number.isFinite(requestedLimit)
      ? Math.min(200, Math.max(1, Math.trunc(requestedLimit)))
      : 100;
    const level = c.req.query('level');
    const levelFilter = level === 'info' || level === 'warn' || level === 'error' ? level : null;
    const result = levelFilter
      ? await c.env.DB.prepare(`
          SELECT id, level, source, event_type, message, method, path,
                 status_code, duration_ms, details_json, created_at
            FROM application_events
           WHERE level = ?
           ORDER BY id DESC
           LIMIT ?
        `).bind(levelFilter, limit).all()
      : await c.env.DB.prepare(`
          SELECT id, level, source, event_type, message, method, path,
                 status_code, duration_ms, details_json, created_at
            FROM application_events
           ORDER BY id DESC
           LIMIT ?
        `).bind(limit).all();
    return c.json({ events: result.results });
  } catch (err) {
    log('error', 'settings', 'GET /settings/activity failed', err);
    return c.json(serverError(), 500);
  }
});
