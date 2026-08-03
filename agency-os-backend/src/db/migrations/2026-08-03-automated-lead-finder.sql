ALTER TABLE agency_settings ADD COLUMN discovery_json TEXT NOT NULL DEFAULT '{}';

CREATE TABLE IF NOT EXISTS prospect_candidates (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  place_id              TEXT NOT NULL UNIQUE,
  company               TEXT NOT NULL,
  phone                 TEXT,
  website               TEXT,
  address               TEXT,
  city                  TEXT,
  state                 TEXT,
  industry              TEXT NOT NULL,
  search_location       TEXT NOT NULL,
  google_rating         REAL,
  google_review_count   INTEGER,
  gbp_claimed           INTEGER NOT NULL DEFAULT 0,
  gbp_photos_count      INTEGER NOT NULL DEFAULT 0,
  gbp_has_hours         INTEGER NOT NULL DEFAULT 0,
  gbp_has_description   INTEGER NOT NULL DEFAULT 0,
  business_status       TEXT,
  opportunity_score     INTEGER NOT NULL DEFAULT 0,
  recommended_tier      INTEGER NOT NULL DEFAULT 1,
  score_reasoning       TEXT,
  source                TEXT NOT NULL DEFAULT 'automated' CHECK (source IN ('automated', 'manual')),
  status                TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'expired')),
  first_seen_at         TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at          TEXT NOT NULL DEFAULT (datetime('now')),
  approved_at           TEXT,
  rejected_at           TEXT,
  suppression_until     TEXT,
  lead_id               INTEGER REFERENCES leads(id),
  updated_at            TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_prospect_candidates_pending
  ON prospect_candidates(status, opportunity_score DESC, first_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_prospect_candidates_suppression
  ON prospect_candidates(place_id, suppression_until);
CREATE INDEX IF NOT EXISTS idx_prospect_candidates_source
  ON prospect_candidates(source, first_seen_at DESC);

CREATE TABLE IF NOT EXISTS prospect_search_runs (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  trigger_type          TEXT NOT NULL CHECK (trigger_type IN ('scheduled', 'manual')),
  industry              TEXT NOT NULL,
  search_location       TEXT NOT NULL,
  started_at            TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at          TEXT,
  status                TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed', 'skipped')),
  results_found         INTEGER NOT NULL DEFAULT 0,
  new_candidates        INTEGER NOT NULL DEFAULT 0,
  refreshed_candidates  INTEGER NOT NULL DEFAULT 0,
  skipped_existing      INTEGER NOT NULL DEFAULT 0,
  skipped_ineligible    INTEGER NOT NULL DEFAULT 0,
  error_message         TEXT,
  scheduled_key         TEXT UNIQUE
);

CREATE INDEX IF NOT EXISTS idx_prospect_search_runs_started
  ON prospect_search_runs(started_at DESC);
