-- Builder Employee v1: durable single-builder queue and audit log.
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
  ON builder_jobs(lead_id)
  WHERE status IN ('waiting', 'building', 'retry');
CREATE INDEX IF NOT EXISTS idx_builder_jobs_claim
  ON builder_jobs(status, created_at);
CREATE INDEX IF NOT EXISTS idx_builder_jobs_completed
  ON builder_jobs(ended_at DESC);

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

CREATE INDEX IF NOT EXISTS idx_builder_events_run
  ON builder_events(run_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_builder_events_job
  ON builder_events(job_id, created_at DESC, id DESC);

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
