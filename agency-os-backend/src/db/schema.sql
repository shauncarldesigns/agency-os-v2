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
  status          TEXT DEFAULT 'cold',
  outcome         TEXT,
  followup        TEXT,
  notes           TEXT,
  source          TEXT,
  -- Relationships
  project_id      INTEGER,
  -- Soft delete (v2.1)
  deleted_at      TEXT,
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
  monthly_pages_target INTEGER DEFAULT 0,
  scrape_completed_at TEXT,
  scrape_data     TEXT,
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
