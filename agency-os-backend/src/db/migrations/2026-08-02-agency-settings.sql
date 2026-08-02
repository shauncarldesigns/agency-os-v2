CREATE TABLE IF NOT EXISTS agency_settings (
  id               INTEGER PRIMARY KEY CHECK (id = 1),
  general_json     TEXT NOT NULL DEFAULT '{}',
  outreach_json    TEXT NOT NULL DEFAULT '{}',
  defaults_json    TEXT NOT NULL DEFAULT '{}',
  updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO agency_settings (id) VALUES (1);
