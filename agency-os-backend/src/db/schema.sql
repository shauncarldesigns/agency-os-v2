-- ==================================================
-- Agency OS v2 — D1 Schema
-- ==================================================

-- ==================================================
-- LEADS — Pipeline / cold call tracker
-- ==================================================
CREATE TABLE IF NOT EXISTS leads (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  -- Identity
  company         TEXT NOT NULL,
  contact         TEXT,
  phone           TEXT,
  phone_e164      TEXT,                          -- Twilio-normalized E.164 number
  phone_valid     INTEGER,                       -- 1 valid, 0 invalid, NULL not checked
  phone_line_type TEXT,                          -- mobile / landline / fixedVoip / nonFixedVoip / unknown / etc.
  phone_carrier   TEXT,
  phone_route     TEXT DEFAULT 'unknown',         -- text / call / review / unknown
  phone_lookup_error TEXT,
  phone_lookup_at TEXT,
  email           TEXT,
  industry        TEXT,
  city            TEXT,
  state           TEXT,
  address         TEXT,
  -- Google Places data
  place_id        TEXT,
  gbp_claimed     INTEGER DEFAULT 0,
  gbp_completeness INTEGER,
  gbp_photos_count INTEGER,
  gbp_categories  TEXT,
  gbp_hours       TEXT,
  google_rating   REAL,
  google_review_count INTEGER,
  google_reviews  TEXT,
  reviews_fetched_at TEXT,
  -- Existing website
  website         TEXT,
  has_website     INTEGER DEFAULT 0,
  pagespeed_desktop INTEGER,
  pagespeed_mobile INTEGER,
  -- Review-mined data
  extracted_services TEXT,
  extracted_service_areas TEXT,
  extracted_strengths TEXT,
  extracted_local_landmarks TEXT,  -- JSON array of sub-city geographic refs mined from reviews
  pitch_quotes    TEXT,
  owner_names     TEXT,
  -- Scoring + tier
  opportunity_score INTEGER,
  opportunity_reasoning TEXT,
  recommended_tier INTEGER,
  -- Pipeline state
  enrichment_status TEXT DEFAULT 'pending',
  enrichment_error TEXT,
  enrichment_stage TEXT,
  enrichment_progress INTEGER NOT NULL DEFAULT 0,
  status          TEXT DEFAULT 'cold',
  outcome         TEXT,
  followup        TEXT,
  notes           TEXT,
  source          TEXT,
  -- Relationships
  project_id      INTEGER,
  -- Soft delete (v2.1)
  deleted_at      TEXT,
  -- Calling-dashboard pointer columns (added 2026-06-14)
  pitch_card_text TEXT,                       -- Cached call-script for execution view; null = "generate me"
  pitch_card_generated_at TEXT,
  last_called_at  TEXT,                       -- Drives 14-day exclusion in session composer
  demo_booked_at  TEXT,                       -- Quick-reference pointer to latest demo
  demo_scheduled_for TEXT,                    -- Quick-reference pointer to latest demo
  receptionist_interested INTEGER NOT NULL DEFAULT 0,
  receptionist_interested_at TEXT,
  -- Automated Pipeline — text + site outreach flow
  pipeline_status TEXT NOT NULL DEFAULT 'awaiting_build',
  site_url        TEXT,
  site_url_raw    TEXT,
  site_review_status TEXT NOT NULL DEFAULT 'pending',
  site_review_reasons TEXT,
  site_review_note TEXT,
  site_review_updated_at TEXT,
  site_review_approved_at TEXT,
  pipeline_brief  TEXT,
  campaign_slug   TEXT,
  clarity_tag     TEXT,
  pipeline_sessions INTEGER NOT NULL DEFAULT 0,
  pipeline_last_action_at TEXT,
  engagement_score INTEGER NOT NULL DEFAULT 0,
  engagement_grade TEXT NOT NULL DEFAULT 'nurture',
  engagement_reasons TEXT,
  clarity_last_sync_at TEXT,
  clarity_last_error TEXT,
  clarity_ignore_until TEXT,                  -- temporary per-lead suppression for known test traffic
  -- Timestamps
  created_at      TEXT DEFAULT (datetime('now')),
  updated_at      TEXT DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_lead_unique ON leads(company, COALESCE(phone, ''));
CREATE INDEX IF NOT EXISTS idx_lead_status ON leads(status);
CREATE INDEX IF NOT EXISTS idx_lead_tier ON leads(recommended_tier);
CREATE INDEX IF NOT EXISTS idx_lead_place ON leads(place_id);
CREATE INDEX IF NOT EXISTS idx_lead_enrich ON leads(enrichment_status);
CREATE INDEX IF NOT EXISTS idx_lead_active ON leads(deleted_at) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_leads_last_called ON leads(last_called_at);
CREATE INDEX IF NOT EXISTS idx_leads_receptionist_interested
  ON leads(receptionist_interested, receptionist_interested_at)
  WHERE receptionist_interested = 1 AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_leads_phone_route ON leads(phone_route);
CREATE INDEX IF NOT EXISTS idx_leads_pipeline_status
  ON leads(pipeline_status)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_leads_engagement_score
  ON leads(engagement_score)
  WHERE deleted_at IS NULL;

-- Builder Employee — local Playwright employee queue + operator controls.
CREATE TABLE IF NOT EXISTS builder_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  status TEXT NOT NULL DEFAULT 'starting'
    CHECK (status IN ('starting','running','paused','stopped','completed','error')),
  total_jobs INTEGER NOT NULL DEFAULT 0,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  ended_at TEXT,
  error_reason TEXT
);
CREATE TABLE IF NOT EXISTS builder_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  run_id INTEGER NOT NULL REFERENCES builder_runs(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'waiting'
    CHECK (status IN ('waiting', 'building', 'completed', 'retry', 'failed')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  lock_token TEXT,
  locked_at TEXT,
  lease_expires_at TEXT,
  started_at TEXT,
  ended_at TEXT,
  duration_ms INTEGER,
  demo_url TEXT,
  failure_reason TEXT,
  artifact_path TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_builder_jobs_active_lead
  ON builder_jobs(lead_id) WHERE status IN ('waiting', 'building', 'retry');
CREATE INDEX IF NOT EXISTS idx_builder_jobs_claim ON builder_jobs(status, created_at);
CREATE INDEX IF NOT EXISTS idx_builder_jobs_completed ON builder_jobs(ended_at DESC);

CREATE TABLE IF NOT EXISTS builder_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER NOT NULL REFERENCES builder_runs(id) ON DELETE CASCADE,
  job_id INTEGER REFERENCES builder_jobs(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  state TEXT,
  step TEXT,
  message TEXT,
  metadata TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_builder_events_run ON builder_events(run_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_builder_events_job ON builder_events(job_id, created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS builder_control (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  paused INTEGER NOT NULL DEFAULT 0 CHECK (paused IN (0, 1)),
  stop_requested INTEGER NOT NULL DEFAULT 0 CHECK (stop_requested IN (0, 1)),
  active_run_id INTEGER REFERENCES builder_runs(id),
  pause_reason TEXT,
  last_worker_seen_at TEXT,
  worker_state TEXT NOT NULL DEFAULT 'offline'
    CHECK (worker_state IN ('offline', 'idle', 'starting', 'running', 'building', 'login_required', 'paused', 'error')),
  current_step TEXT,
  worker_message TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT OR IGNORE INTO builder_control (id) VALUES (1);

-- ==================================================
-- CALL_LOG — Per-lead call history
-- ==================================================
CREATE TABLE IF NOT EXISTS call_log (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id         INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  outcome         TEXT NOT NULL,
  notes           TEXT NOT NULL,
  followup_date   TEXT,
  objection_hits  TEXT,                                          -- JSON array; see playbook spec
  recording_url   TEXT,                                          -- R2 pub URL when operator recorded the call
  created_at      TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_call_lead ON call_log(lead_id, created_at DESC);

-- ==================================================
-- PROJECTS — Client sites (one per signed client)
-- ==================================================
CREATE TABLE IF NOT EXISTS projects (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id         INTEGER REFERENCES leads(id),
  name            TEXT NOT NULL,
  slug            TEXT UNIQUE NOT NULL,
  tier            INTEGER NOT NULL,
  -- Business identity (frozen at signing)
  business_name   TEXT NOT NULL,
  industry        TEXT,
  city            TEXT,
  state           TEXT,
  phone           TEXT,
  email           TEXT,
  description     TEXT,
  years_in_business INTEGER,
  founded_year    INTEGER,
  owner_name      TEXT,
  owner_credentials TEXT,
  -- Brand
  primary_color   TEXT,
  accent_color    TEXT,
  tagline         TEXT,
  photography_direction TEXT,
  brand_voice_notes TEXT,
  -- Services + areas (frozen for site brief)
  services        TEXT,
  service_areas   TEXT,
  -- v2.1: monthly cadence + scrape data
  monthly_pages_target INTEGER DEFAULT 0, -- Growth clients persist 3; non-recurring tiers use 0
  scrape_completed_at TEXT,
  scrape_data     TEXT,
  -- landingsite.ai
  landingsite_url TEXT,
  custom_domain   TEXT,
  -- Reporting integrations (Tier 3)
  gsc_property_url TEXT,                      -- Search Console site URL (sc-domain:foo.com or https://foo.com/)
  cf_zone_id      TEXT,                       -- Cloudflare zone for traffic analytics (only if hosted via CF)
  client_email    TEXT,                       -- where to send monthly reports
  -- Coverage tracking
  pages_built     INTEGER DEFAULT 0,
  pages_planned   INTEGER DEFAULT 0,
  -- Tier 3 specific
  next_pages_due  TEXT,
  merchynt_active INTEGER DEFAULT 0,
  contract_start  TEXT,
  contract_min_end TEXT,
  selected_plan TEXT,
  commitment_term TEXT,
  discovery_scheduled_for TEXT,
  -- Status
  status          TEXT DEFAULT 'building',
  is_internal     INTEGER NOT NULL DEFAULT 0,
  -- Reviews snapshot at project time
  reviews_snapshot TEXT,
  -- DNS management (added 2026-06-14) — set later in the project lifecycle
  -- via the "Add domain & DNS" Quick Action. cf_zone_id above is REUSED for
  -- this feature; not duplicating into a separate cloudflare_zone_id column.
  domain          TEXT,
  cf_nameservers  TEXT,                       -- JSON array of Cloudflare-assigned nameservers
  dns_status      TEXT NOT NULL DEFAULT 'not_created', -- not_created | pending | active | failed
  dns_last_checked TEXT,
  registrar       TEXT,
  domain_owner_email TEXT,
  -- Timestamps
  created_at      TEXT DEFAULT (datetime('now')),
  updated_at      TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_proj_lead ON projects(lead_id);
CREATE INDEX IF NOT EXISTS idx_proj_tier ON projects(tier);
CREATE INDEX IF NOT EXISTS idx_proj_status ON projects(status);
-- Lets the hourly DNS poll cron cheaply find zones still awaiting nameserver delegation.
CREATE INDEX IF NOT EXISTS idx_projects_dns_pending ON projects(dns_status) WHERE dns_status = 'pending';

-- ==================================================
-- PROJECT DISCOVERY — client-supplied planning answers
-- ==================================================
CREATE TABLE IF NOT EXISTS project_discovery (
  project_id      INTEGER PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  status          TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'complete')),
  is_test_mode    INTEGER NOT NULL DEFAULT 0,
  answers_json    TEXT NOT NULL DEFAULT '{}',
  completed_at    TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_project_discovery_status
  ON project_discovery(status, updated_at);

CREATE TABLE IF NOT EXISTS project_onboarding_checks (
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  item_key TEXT NOT NULL,
  completed INTEGER NOT NULL DEFAULT 0,
  completed_at TEXT,
  notes TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (project_id, item_key)
);

-- ==================================================
-- PAGES — Each page built in landingsite.ai
-- ==================================================
CREATE TABLE IF NOT EXISTS pages (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id      INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  type            TEXT NOT NULL,
  service         TEXT,
  city            TEXT,
  slug            TEXT,
  url             TEXT,
  title           TEXT,
  meta_description TEXT,
  status          TEXT DEFAULT 'planned',  -- 'planned' | 'briefed' | 'complete'
  brief_content   TEXT,                    -- deprecated; brief_id points to the briefs table now
  cowork_job_id   TEXT,                    -- deprecated; retained for back-compat on old rows
  built_at        TEXT,
  -- v2.1+: brief linkage + manual completion tracking
  brief_id        INTEGER REFERENCES briefs(id),
  batch_period    TEXT,                    -- deprecated; retained for back-compat
  billing_status  TEXT DEFAULT 'included', -- 'included' | 'add_on' | 'comp'
  published_url   TEXT,
  marked_complete_at TEXT,
  operator_notes  TEXT,
  created_at      TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_pages_proj ON pages(project_id, status);
CREATE INDEX IF NOT EXISTS idx_pages_batch ON pages(project_id, batch_period);

-- ==================================================
-- MONTHLY GROWTH CYCLES — managed Growth-plan delivery
-- ==================================================
CREATE TABLE IF NOT EXISTS growth_cycles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  period TEXT NOT NULL,
  phase TEXT NOT NULL DEFAULT 'expansion' CHECK (phase IN ('foundation', 'expansion', 'optimization')),
  status TEXT NOT NULL DEFAULT 'planning' CHECK (status IN ('planning', 'active', 'complete')),
  due_date TEXT NOT NULL,
  client_summary TEXT,
  next_priorities TEXT,
  generated_at TEXT,
  generated_by TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(project_id, period)
);
CREATE INDEX IF NOT EXISTS idx_growth_cycles_project_period ON growth_cycles(project_id, period DESC);

CREATE TABLE IF NOT EXISTS growth_work_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cycle_id INTEGER NOT NULL REFERENCES growth_cycles(id) ON DELETE CASCADE,
  category TEXT NOT NULL CHECK (category IN ('created', 'improved', 'google_business', 'proof', 'measured', 'technical', 'conversion')),
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'in_progress', 'complete', 'blocked')),
  evidence_url TEXT,
  page_id INTEGER REFERENCES pages(id) ON DELETE SET NULL,
  brief_id INTEGER REFERENCES briefs(id) ON DELETE SET NULL,
  recommended_page_type TEXT,
  recommended_service TEXT,
  recommended_city TEXT,
  completion_signal TEXT,
  work_tier TEXT NOT NULL DEFAULT 'committed' CHECK (work_tier IN ('committed', 'bonus')),
  client_visible INTEGER NOT NULL DEFAULT 1,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_growth_work_items_cycle_status ON growth_work_items(cycle_id, status);
CREATE INDEX IF NOT EXISTS idx_growth_work_items_cycle_tier_status ON growth_work_items(cycle_id, work_tier, status);

CREATE TABLE IF NOT EXISTS growth_strategies (
  project_id INTEGER PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  planning_mode TEXT NOT NULL DEFAULT 'auto' CHECK (planning_mode IN ('auto', 'balanced', 'expansion', 'optimization')),
  primary_objective TEXT,
  priority_services TEXT NOT NULL DEFAULT '[]',
  priority_areas TEXT NOT NULL DEFAULT '[]',
  seasonal_priorities TEXT,
  constraints TEXT,
  auto_generate INTEGER NOT NULL DEFAULT 0,
  require_approval INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ==================================================
-- BRIEFS — Master + Page briefs (v2.2)
-- ==================================================
CREATE TABLE IF NOT EXISTS briefs (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id          INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind                TEXT NOT NULL,  -- 'master' | 'page'
  page_id             INTEGER REFERENCES pages(id),  -- NULL for master briefs
  content_markdown    TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'saved',  -- 'briefed' | 'complete' (page); 'draft' | 'saved' | 'archived' (master)
  version             INTEGER NOT NULL DEFAULT 1,
  tbd_count           INTEGER DEFAULT 0,
  batch_period        TEXT,           -- deprecated; retained for back-compat
  generated_by_model  TEXT,
  generation_input    TEXT,
  generated_at        TEXT DEFAULT (datetime('now')),
  updated_at          TEXT,
  completed_at        TEXT,
  supersedes_brief_id INTEGER REFERENCES briefs(id)
);
CREATE INDEX IF NOT EXISTS idx_briefs_project ON briefs(project_id, kind, status);
CREATE INDEX IF NOT EXISTS idx_briefs_page ON briefs(page_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_briefs_master_per_project
  ON briefs(project_id)
  WHERE kind = 'master' AND supersedes_brief_id IS NULL;

-- ==================================================
-- BRAND_ATTRIBUTES — operator/scrape/claude-supplied brand voice signals (v2.1)
-- ==================================================
CREATE TABLE IF NOT EXISTS brand_attributes (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id      INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  category        TEXT NOT NULL,
  value           TEXT NOT NULL,
  source          TEXT,
  weight          INTEGER DEFAULT 1,
  created_at      TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_brand_attr_proj ON brand_attributes(project_id, category);

-- ==================================================
-- TESTIMONIALS — curated customer quotes per project (v2.1)
-- ==================================================
CREATE TABLE IF NOT EXISTS testimonials (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id      INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  author_name     TEXT NOT NULL,
  author_location TEXT,
  quote           TEXT NOT NULL,
  rating          INTEGER,
  source          TEXT,
  is_featured     INTEGER DEFAULT 0,
  created_at      TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_testimonials_proj ON testimonials(project_id, is_featured);

-- (Legacy `brief_jobs` table was dropped in 2026-05-brief-studio migration —
-- replaced by the `briefs` table with explicit kind/status/version columns.)

-- ==================================================
-- SEO_SNAPSHOTS — Monthly metrics for Tier 3 reports
-- ==================================================
CREATE TABLE IF NOT EXISTS seo_snapshots (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id      INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  period          TEXT NOT NULL,
  impressions     INTEGER,
  clicks          INTEGER,
  avg_position    REAL,
  ctr             REAL,
  pagespeed_desktop INTEGER,
  pagespeed_mobile INTEGER,
  visitors        INTEGER,
  pageviews       INTEGER,
  top_keywords    TEXT,
  top_pages       TEXT,
  exec_summary    TEXT,
  created_at      TEXT DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_seo_unique ON seo_snapshots(project_id, period);

-- ==================================================
-- SEO_AUDITS — Technical crawl runs, pages, and findings
-- ==================================================
CREATE TABLE IF NOT EXISTS seo_audit_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'complete', 'failed')),
  start_url TEXT NOT NULL,
  pages_crawled INTEGER NOT NULL DEFAULT 0,
  critical_count INTEGER NOT NULL DEFAULT 0,
  warning_count INTEGER NOT NULL DEFAULT 0,
  opportunity_count INTEGER NOT NULL DEFAULT 0,
  health_score INTEGER,
  robots_status TEXT,
  sitemap_status TEXT,
  error_message TEXT,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_seo_audit_runs_project ON seo_audit_runs(project_id, id DESC);

CREATE TABLE IF NOT EXISTS seo_audit_pages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER NOT NULL REFERENCES seo_audit_runs(id) ON DELETE CASCADE,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  page_id INTEGER REFERENCES pages(id) ON DELETE SET NULL,
  url TEXT NOT NULL,
  status_code INTEGER,
  redirect_count INTEGER NOT NULL DEFAULT 0,
  title TEXT,
  meta_description TEXT,
  canonical_url TEXT,
  h1_count INTEGER NOT NULL DEFAULT 0,
  word_count INTEGER NOT NULL DEFAULT 0,
  internal_links INTEGER NOT NULL DEFAULT 0,
  images INTEGER NOT NULL DEFAULT 0,
  images_missing_alt INTEGER NOT NULL DEFAULT 0,
  has_schema INTEGER NOT NULL DEFAULT 0,
  is_indexable INTEGER NOT NULL DEFAULT 1,
  in_sitemap INTEGER NOT NULL DEFAULT 0,
  UNIQUE(run_id, url)
);
CREATE INDEX IF NOT EXISTS idx_seo_audit_pages_page ON seo_audit_pages(page_id, run_id DESC);

CREATE TABLE IF NOT EXISTS seo_audit_findings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER NOT NULL REFERENCES seo_audit_runs(id) ON DELETE CASCADE,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  page_id INTEGER REFERENCES pages(id) ON DELETE SET NULL,
  page_url TEXT,
  severity TEXT NOT NULL CHECK (severity IN ('critical', 'warning', 'opportunity')),
  rule_key TEXT NOT NULL,
  title TEXT NOT NULL,
  details TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_seo_audit_findings_run_severity ON seo_audit_findings(run_id, severity, rule_key);
CREATE INDEX IF NOT EXISTS idx_seo_audit_findings_page ON seo_audit_findings(page_id, run_id DESC);

-- ==================================================
-- KEYWORD_TRACKING — Per-keyword over time
-- ==================================================
CREATE TABLE IF NOT EXISTS keyword_tracking (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id      INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  query           TEXT NOT NULL,
  period          TEXT NOT NULL,
  position        REAL,
  impressions     INTEGER,
  clicks          INTEGER,
  ctr             REAL,
  created_at      TEXT DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_kw_unique ON keyword_tracking(project_id, query, period);

-- ==================================================
-- REPORT_HISTORY — Track which reports were sent
-- ==================================================
CREATE TABLE IF NOT EXISTS report_history (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id      INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  period          TEXT NOT NULL,
  pdf_url         TEXT,
  sent_to         TEXT,
  sent_at         TEXT,
  created_at      TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_report_proj ON report_history(project_id, period);

-- ==================================================
-- CALLING DASHBOARD — Sessions, demos, callbacks
-- ==================================================
-- Added 2026-06-14. See db/migrations/2026-06-14-calling-dashboard.sql for
-- column-by-column rationale and indexing decisions.

CREATE TABLE IF NOT EXISTS sessions (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  session_date      TEXT NOT NULL,                            -- 'YYYY-MM-DD' for auto, 'hot' for the hot session
  block             TEXT NOT NULL,                            -- 'morning' | 'evening' | 'hot'
  industry          TEXT NOT NULL,                            -- Google Places primaryType, or 'mixed' for hot
  geographic_filter TEXT,                                     -- JSON array of cities; null = full service area
  score_floor       INTEGER NOT NULL DEFAULT 50,
  lead_count_target INTEGER NOT NULL DEFAULT 40,
  status            TEXT NOT NULL DEFAULT 'planned',          -- planned | active | complete
  kind              TEXT NOT NULL DEFAULT 'auto',             -- 'auto' (composed) | 'hot' (operator-curated)
  started_at        TEXT,
  completed_at      TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_session_unique ON sessions(session_date, block);
CREATE INDEX IF NOT EXISTS idx_session_status ON sessions(status);
CREATE INDEX IF NOT EXISTS idx_session_active ON sessions(status) WHERE status = 'active';

CREATE TABLE IF NOT EXISTS session_leads (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id    INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  lead_id       INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  position      INTEGER NOT NULL,
  call_outcome  TEXT,                                          -- voicemail | not_interested | callback | booked | skipped
  called_at     TEXT,
  is_callback   INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_session_lead_unique ON session_leads(session_id, lead_id);
CREATE INDEX IF NOT EXISTS idx_session_lead_outcome ON session_leads(session_id, call_outcome);
CREATE INDEX IF NOT EXISTS idx_session_lead_next ON session_leads(session_id, position) WHERE call_outcome IS NULL;

CREATE TABLE IF NOT EXISTS callbacks (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id       INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  due_date      TEXT NOT NULL,
  block_hint    TEXT,                                          -- 'morning' | 'evening' | null
  notes         TEXT,
  status        TEXT NOT NULL DEFAULT 'pending',               -- pending | completed | missed
  completed_at  TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_callback_due ON callbacks(due_date, status);
CREATE INDEX IF NOT EXISTS idx_callback_lead ON callbacks(lead_id);
CREATE INDEX IF NOT EXISTS idx_callback_pending ON callbacks(due_date) WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS demos (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id             INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  booked_at           TEXT NOT NULL DEFAULT (datetime('now')),
  scheduled_for       TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'booked',          -- booked | held | no_show | rescheduled
  honeybook_confirmed INTEGER NOT NULL DEFAULT 0,
  outcome_notes       TEXT,
  status_set_at       TEXT,
  created_at          TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_demo_lead ON demos(lead_id);
CREATE INDEX IF NOT EXISTS idx_demo_status ON demos(status);
CREATE INDEX IF NOT EXISTS idx_demo_scheduled ON demos(scheduled_for);
CREATE INDEX IF NOT EXISTS idx_demo_awaiting ON demos(scheduled_for) WHERE status = 'booked';
CREATE INDEX IF NOT EXISTS idx_demo_noshow ON demos(status) WHERE status = 'no_show';

CREATE TABLE IF NOT EXISTS demo_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  demo_id     INTEGER NOT NULL REFERENCES demos(id) ON DELETE CASCADE,
  event_type  TEXT NOT NULL,                                   -- created | held | no_show | rescheduled
  event_data  TEXT,                                            -- JSON
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_demo_event_demo ON demo_events(demo_id, created_at);

-- Single-row table holding the industry-rotation cursor across weeks.
CREATE TABLE IF NOT EXISTS weekly_rotation (
  id              INTEGER PRIMARY KEY CHECK (id = 1),
  last_industry   TEXT,
  last_session_at TEXT,
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT OR IGNORE INTO weekly_rotation (id) VALUES (1);

-- Single-operator application preferences. Secrets remain Worker bindings.
CREATE TABLE IF NOT EXISTS agency_settings (
  id               INTEGER PRIMARY KEY CHECK (id = 1),
  general_json     TEXT NOT NULL DEFAULT '{}',
  outreach_json    TEXT NOT NULL DEFAULT '{}',
  defaults_json    TEXT NOT NULL DEFAULT '{}',
  discovery_json   TEXT NOT NULL DEFAULT '{}',
  updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO agency_settings (id) VALUES (1);

CREATE TABLE IF NOT EXISTS prospect_candidates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  place_id TEXT NOT NULL UNIQUE,
  company TEXT NOT NULL,
  phone TEXT,
  website TEXT,
  address TEXT,
  city TEXT,
  state TEXT,
  industry TEXT NOT NULL,
  search_location TEXT NOT NULL,
  google_rating REAL,
  google_review_count INTEGER,
  gbp_claimed INTEGER NOT NULL DEFAULT 0,
  gbp_photos_count INTEGER NOT NULL DEFAULT 0,
  gbp_has_hours INTEGER NOT NULL DEFAULT 0,
  gbp_has_description INTEGER NOT NULL DEFAULT 0,
  business_status TEXT,
  opportunity_score INTEGER NOT NULL DEFAULT 0,
  recommended_tier INTEGER NOT NULL DEFAULT 1,
  score_reasoning TEXT,
  source TEXT NOT NULL DEFAULT 'automated' CHECK (source IN ('automated', 'manual')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'expired')),
  first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  approved_at TEXT,
  rejected_at TEXT,
  suppression_until TEXT,
  lead_id INTEGER REFERENCES leads(id),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_prospect_candidates_pending ON prospect_candidates(status, opportunity_score DESC, first_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_prospect_candidates_suppression ON prospect_candidates(place_id, suppression_until);
CREATE INDEX IF NOT EXISTS idx_prospect_candidates_source ON prospect_candidates(source, first_seen_at DESC);

CREATE TABLE IF NOT EXISTS prospect_search_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trigger_type TEXT NOT NULL CHECK (trigger_type IN ('scheduled', 'manual')),
  industry TEXT NOT NULL,
  search_location TEXT NOT NULL,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT,
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed', 'skipped')),
  results_found INTEGER NOT NULL DEFAULT 0,
  new_candidates INTEGER NOT NULL DEFAULT 0,
  refreshed_candidates INTEGER NOT NULL DEFAULT 0,
  skipped_existing INTEGER NOT NULL DEFAULT 0,
  skipped_ineligible INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  scheduled_key TEXT UNIQUE
);
CREATE INDEX IF NOT EXISTS idx_prospect_search_runs_started ON prospect_search_runs(started_at DESC);

-- ==================================================
-- PLAYBOOK_GENERATIONS — Claude-generated rebuttal log
-- ==================================================
CREATE TABLE IF NOT EXISTS playbook_generations (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id             INTEGER REFERENCES leads(id) ON DELETE SET NULL,
  objection_id        TEXT NOT NULL,
  request_json        TEXT NOT NULL,
  response_json       TEXT,
  model               TEXT NOT NULL,
  used_variant_index  INTEGER,
  duration_ms         INTEGER NOT NULL,
  status              TEXT NOT NULL,                  -- 'success' | 'parse_error' | 'api_error'
  error_message       TEXT,
  created_at          TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_playbook_gen_objection ON playbook_generations(objection_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_playbook_gen_lead ON playbook_generations(lead_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_playbook_gen_used ON playbook_generations(objection_id, used_variant_index) WHERE used_variant_index IS NOT NULL;

-- Persistent, sanitized operational feed shown under Settings → Activity & errors.
CREATE TABLE IF NOT EXISTS application_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  level TEXT NOT NULL CHECK (level IN ('info', 'warn', 'error')),
  source TEXT NOT NULL,
  event_type TEXT NOT NULL,
  message TEXT NOT NULL,
  method TEXT,
  path TEXT,
  status_code INTEGER,
  duration_ms INTEGER,
  details_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_application_events_created ON application_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_application_events_level_created ON application_events(level, created_at DESC);
