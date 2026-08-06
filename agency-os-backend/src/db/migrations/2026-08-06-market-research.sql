-- Market Research Phase 1 — demand data per industry × location market.
-- Demand is a property of a MARKET, not a lead. Volume is never fetched
-- per lead; one research run covers an entire industry's pipeline in a city.

ALTER TABLE agency_settings ADD COLUMN research_json TEXT NOT NULL DEFAULT '{}';

CREATE TABLE IF NOT EXISTS markets (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  industry          TEXT NOT NULL,
  location_label    TEXT NOT NULL,        -- 'Green Bay, WI'
  geo_target_id     TEXT NOT NULL,        -- Google Ads city criteria ID
  latitude          REAL NOT NULL,
  longitude         REAL NOT NULL,
  is_active         INTEGER NOT NULL DEFAULT 1,
  last_researched_at TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (industry, geo_target_id)
);

CREATE TABLE IF NOT EXISTS research_runs (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  market_id      INTEGER NOT NULL REFERENCES markets(id) ON DELETE CASCADE,
  trigger        TEXT NOT NULL DEFAULT 'manual' CHECK (trigger IN ('manual','scheduled')),
  provider       TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running','complete','failed','partial')),
  keywords_count INTEGER NOT NULL DEFAULT 0,
  error_detail   TEXT,
  started_at     TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at   TEXT
);

-- Upserts on (market_id, keyword) so history doesn't balloon; the latest
-- run's numbers overwrite the prior month's.
CREATE TABLE IF NOT EXISTS market_keywords (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  market_id         INTEGER NOT NULL REFERENCES markets(id) ON DELETE CASCADE,
  run_id            INTEGER REFERENCES research_runs(id),
  keyword           TEXT NOT NULL,
  monthly_volume    INTEGER,
  competition       TEXT,
  competition_index INTEGER,
  cpc_low           REAL,
  cpc_high          REAL,
  trend_json        TEXT,                 -- 12-month array
  is_near_me        INTEGER NOT NULL DEFAULT 0,
  fetched_at        TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (market_id, keyword)
);

-- Append-only: every capture is kept so map pack rank movement over time
-- is queryable. This is the one research table where history has value.
CREATE TABLE IF NOT EXISTS map_pack_results (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  market_id      INTEGER NOT NULL REFERENCES markets(id) ON DELETE CASCADE,
  run_id         INTEGER REFERENCES research_runs(id),
  keyword        TEXT NOT NULL,
  position       INTEGER NOT NULL,
  place_id       TEXT,
  company        TEXT NOT NULL,
  has_website    INTEGER NOT NULL DEFAULT 0,
  website        TEXT,
  google_rating  REAL,
  review_count   INTEGER,
  captured_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_market_keywords_volume
  ON market_keywords(market_id, monthly_volume DESC);
CREATE INDEX IF NOT EXISTS idx_map_pack_market_keyword
  ON map_pack_results(market_id, keyword, position);
CREATE INDEX IF NOT EXISTS idx_research_runs_market
  ON research_runs(market_id, started_at DESC);
