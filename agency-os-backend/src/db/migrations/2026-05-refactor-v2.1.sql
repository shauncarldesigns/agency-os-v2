-- ============================================================================
-- v2.1 Refactor migration — 2026-05
-- ============================================================================
-- Adds briefs / brand_attributes / testimonials tables.
-- Extends pages and projects with v2.1 columns.
-- Adds soft-delete column to leads.
--
-- ALTER TABLE ADD COLUMN is NOT idempotent in SQLite/D1 — if a column already
-- exists the statement errors. Run this exactly once per database.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- NEW: briefs
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS briefs (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id          INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind                TEXT NOT NULL,  -- 'homepage_demo' | 'master' | 'monthly_batch'
  content_markdown    TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'generated',  -- 'generated' | 'in_progress' | 'completed' | 'archived'
  batch_period        TEXT,           -- '2026-06' for monthly_batch, NULL otherwise
  generated_by_model  TEXT,
  generation_input    TEXT,           -- JSON snapshot of the data fed to the prompt
  generated_at        TEXT DEFAULT (datetime('now')),
  completed_at        TEXT,
  supersedes_brief_id INTEGER REFERENCES briefs(id)
);
CREATE INDEX IF NOT EXISTS idx_briefs_project ON briefs(project_id, kind, status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_briefs_monthly
  ON briefs(project_id, batch_period)
  WHERE batch_period IS NOT NULL;

-- ----------------------------------------------------------------------------
-- NEW: brand_attributes
-- ----------------------------------------------------------------------------
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

-- ----------------------------------------------------------------------------
-- NEW: testimonials
-- ----------------------------------------------------------------------------
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

-- ----------------------------------------------------------------------------
-- MODIFY: pages — add brief linkage + completion tracking
-- ----------------------------------------------------------------------------
ALTER TABLE pages ADD COLUMN brief_id           INTEGER REFERENCES briefs(id);
ALTER TABLE pages ADD COLUMN batch_period       TEXT;
ALTER TABLE pages ADD COLUMN published_url      TEXT;
ALTER TABLE pages ADD COLUMN marked_complete_at TEXT;
ALTER TABLE pages ADD COLUMN operator_notes     TEXT;

-- ----------------------------------------------------------------------------
-- MODIFY: projects — add brand identity + scrape data
-- (primary_color already exists; not re-added)
-- ----------------------------------------------------------------------------
ALTER TABLE projects ADD COLUMN monthly_pages_target INTEGER DEFAULT 0;
ALTER TABLE projects ADD COLUMN tagline              TEXT;
ALTER TABLE projects ADD COLUMN founded_year         INTEGER;
ALTER TABLE projects ADD COLUMN owner_name           TEXT;
ALTER TABLE projects ADD COLUMN owner_credentials    TEXT;
ALTER TABLE projects ADD COLUMN accent_color         TEXT;
ALTER TABLE projects ADD COLUMN photography_direction TEXT;
ALTER TABLE projects ADD COLUMN scrape_completed_at  TEXT;
ALTER TABLE projects ADD COLUMN scrape_data          TEXT;

-- ----------------------------------------------------------------------------
-- MODIFY: leads — soft delete
-- ----------------------------------------------------------------------------
ALTER TABLE leads ADD COLUMN deleted_at TEXT;
CREATE INDEX IF NOT EXISTS idx_lead_active ON leads(deleted_at) WHERE deleted_at IS NULL;
