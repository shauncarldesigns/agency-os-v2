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

CREATE INDEX IF NOT EXISTS idx_application_events_created
  ON application_events(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_application_events_level_created
  ON application_events(level, created_at DESC);
