-- Client discovery workspace. Answers stay JSON-backed so the conversational
-- questionnaire can evolve without one migration per wording change.
CREATE TABLE IF NOT EXISTS project_discovery (
  project_id INTEGER PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'complete')),
  is_test_mode INTEGER NOT NULL DEFAULT 0,
  answers_json TEXT NOT NULL DEFAULT '{}',
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_project_discovery_status
  ON project_discovery(status, updated_at);
