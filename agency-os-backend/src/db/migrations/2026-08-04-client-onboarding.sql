CREATE TABLE IF NOT EXISTS project_onboarding_checks (
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  item_key TEXT NOT NULL,
  completed INTEGER NOT NULL DEFAULT 0,
  completed_at TEXT,
  notes TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (project_id, item_key)
);
