CREATE TABLE IF NOT EXISTS design_references (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT,
  source_lead_id INTEGER REFERENCES leads(id) ON DELETE SET NULL,
  source_project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  source_url TEXT,
  industry TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','ready','archived')),
  notes TEXT,
  style_tags TEXT NOT NULL DEFAULT '[]',
  design_recipe TEXT NOT NULL,
  technical_tokens TEXT NOT NULL DEFAULT '{}',
  reuse_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_design_references_status
  ON design_references(status, updated_at DESC);

ALTER TABLE leads ADD COLUMN design_reference_id INTEGER REFERENCES design_references(id) ON DELETE SET NULL;
ALTER TABLE leads ADD COLUMN design_recipe_snapshot TEXT;
