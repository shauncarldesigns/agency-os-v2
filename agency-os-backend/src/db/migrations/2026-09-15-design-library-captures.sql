CREATE TABLE IF NOT EXISTS design_capture_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  design_reference_id INTEGER NOT NULL REFERENCES design_references(id) ON DELETE CASCADE,
  source_url TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','capturing','completed','failed')),
  lock_token TEXT,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  started_at TEXT,
  completed_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_design_capture_jobs_status ON design_capture_jobs(status, created_at);

CREATE TABLE IF NOT EXISTS design_reference_assets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  design_reference_id INTEGER NOT NULL REFERENCES design_references(id) ON DELETE CASCADE,
  capture_job_id INTEGER NOT NULL REFERENCES design_capture_jobs(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN ('desktop_full','mobile_full')),
  storage_key TEXT NOT NULL UNIQUE,
  viewport_width INTEGER NOT NULL,
  viewport_height INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(capture_job_id, kind)
);

CREATE INDEX IF NOT EXISTS idx_design_reference_assets_design ON design_reference_assets(design_reference_id, created_at);
