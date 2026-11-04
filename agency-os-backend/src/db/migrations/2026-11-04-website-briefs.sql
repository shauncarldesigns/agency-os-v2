ALTER TABLE design_references ADD COLUMN purpose TEXT NOT NULL DEFAULT 'library';
CREATE TABLE IF NOT EXISTS website_briefs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id INTEGER NOT NULL UNIQUE REFERENCES leads(id),
  source_url TEXT NOT NULL,
  design_reference_id INTEGER REFERENCES design_references(id),
  scrape_data TEXT,
  brand_colors TEXT NOT NULL DEFAULT '',
  brand_fonts TEXT NOT NULL DEFAULT '',
  direction TEXT NOT NULL DEFAULT '',
  brief TEXT NOT NULL DEFAULT '',
  scanned_at TEXT,
  generated_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
