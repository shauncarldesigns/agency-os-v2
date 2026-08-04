CREATE TABLE IF NOT EXISTS growth_cycles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  period TEXT NOT NULL,
  phase TEXT NOT NULL DEFAULT 'expansion' CHECK (phase IN ('foundation', 'expansion', 'optimization')),
  status TEXT NOT NULL DEFAULT 'planning' CHECK (status IN ('planning', 'active', 'complete')),
  due_date TEXT NOT NULL,
  client_summary TEXT,
  next_priorities TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(project_id, period)
);

CREATE INDEX IF NOT EXISTS idx_growth_cycles_project_period
  ON growth_cycles(project_id, period DESC);

CREATE TABLE IF NOT EXISTS growth_work_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cycle_id INTEGER NOT NULL REFERENCES growth_cycles(id) ON DELETE CASCADE,
  category TEXT NOT NULL CHECK (category IN ('created', 'improved', 'google_business', 'proof', 'measured', 'technical', 'conversion')),
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'in_progress', 'complete', 'blocked')),
  evidence_url TEXT,
  page_id INTEGER REFERENCES pages(id) ON DELETE SET NULL,
  client_visible INTEGER NOT NULL DEFAULT 1,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_growth_work_items_cycle_status
  ON growth_work_items(cycle_id, status);
