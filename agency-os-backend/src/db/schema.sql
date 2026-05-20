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
  pitch_quotes    TEXT,
  owner_names     TEXT,
  -- Scoring + tier
  opportunity_score INTEGER,
  recommended_tier INTEGER,
  -- Pipeline state
  enrichment_status TEXT DEFAULT 'pending',
  enrichment_error TEXT,
  status          TEXT DEFAULT 'cold',
  outcome         TEXT,
  followup        TEXT,
  notes           TEXT,
  source          TEXT,
  -- Relationships
  project_id      INTEGER,
  -- Timestamps
  created_at      TEXT DEFAULT (datetime('now')),
  updated_at      TEXT DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_lead_unique ON leads(company, COALESCE(phone, ''));
CREATE INDEX IF NOT EXISTS idx_lead_status ON leads(status);
CREATE INDEX IF NOT EXISTS idx_lead_tier ON leads(recommended_tier);
CREATE INDEX IF NOT EXISTS idx_lead_place ON leads(place_id);
CREATE INDEX IF NOT EXISTS idx_lead_enrich ON leads(enrichment_status);

-- ==================================================
-- CALL_LOG — Per-lead call history
-- ==================================================
CREATE TABLE IF NOT EXISTS call_log (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id         INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  outcome         TEXT NOT NULL,
  notes           TEXT NOT NULL,
  followup_date   TEXT,
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
  -- Brand
  primary_color   TEXT,
  brand_voice_notes TEXT,
  -- Services + areas (frozen for site brief)
  services        TEXT,
  service_areas   TEXT,
  -- landingsite.ai
  landingsite_project_id TEXT,
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
  -- Status
  status          TEXT DEFAULT 'building',
  -- Reviews snapshot at project time
  reviews_snapshot TEXT,
  -- Timestamps
  created_at      TEXT DEFAULT (datetime('now')),
  updated_at      TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_proj_lead ON projects(lead_id);
CREATE INDEX IF NOT EXISTS idx_proj_tier ON projects(tier);
CREATE INDEX IF NOT EXISTS idx_proj_status ON projects(status);

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
  status          TEXT DEFAULT 'queued',
  brief_content   TEXT,
  cowork_job_id   TEXT,
  built_at        TEXT,
  created_at      TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_pages_proj ON pages(project_id, status);

-- ==================================================
-- BRIEF_JOBS — Cowork queue tracking
-- ==================================================
CREATE TABLE IF NOT EXISTS brief_jobs (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id      INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  page_id         INTEGER REFERENCES pages(id),
  job_type        TEXT NOT NULL,
  brief_markdown  TEXT NOT NULL,
  status          TEXT DEFAULT 'queued',
  cowork_started_at TEXT,
  cowork_completed_at TEXT,
  error_message   TEXT,
  retries         INTEGER DEFAULT 0,
  created_at      TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON brief_jobs(status, created_at);

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
