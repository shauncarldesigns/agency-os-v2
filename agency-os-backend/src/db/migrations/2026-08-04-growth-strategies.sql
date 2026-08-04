CREATE TABLE IF NOT EXISTS growth_strategies (
  project_id INTEGER PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  planning_mode TEXT NOT NULL DEFAULT 'auto' CHECK (planning_mode IN ('auto', 'balanced', 'expansion', 'optimization')),
  primary_objective TEXT,
  priority_services TEXT NOT NULL DEFAULT '[]',
  priority_areas TEXT NOT NULL DEFAULT '[]',
  seasonal_priorities TEXT,
  constraints TEXT,
  auto_generate INTEGER NOT NULL DEFAULT 0,
  require_approval INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

ALTER TABLE growth_cycles ADD COLUMN generated_at TEXT;
ALTER TABLE growth_cycles ADD COLUMN generated_by TEXT;
