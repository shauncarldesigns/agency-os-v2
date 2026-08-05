CREATE TABLE IF NOT EXISTS seo_audit_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'complete', 'failed')),
  start_url TEXT NOT NULL,
  pages_crawled INTEGER NOT NULL DEFAULT 0,
  critical_count INTEGER NOT NULL DEFAULT 0,
  warning_count INTEGER NOT NULL DEFAULT 0,
  opportunity_count INTEGER NOT NULL DEFAULT 0,
  health_score INTEGER,
  robots_status TEXT,
  sitemap_status TEXT,
  error_message TEXT,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_seo_audit_runs_project
  ON seo_audit_runs(project_id, id DESC);

CREATE TABLE IF NOT EXISTS seo_audit_pages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER NOT NULL REFERENCES seo_audit_runs(id) ON DELETE CASCADE,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  page_id INTEGER REFERENCES pages(id) ON DELETE SET NULL,
  url TEXT NOT NULL,
  status_code INTEGER,
  redirect_count INTEGER NOT NULL DEFAULT 0,
  title TEXT,
  meta_description TEXT,
  canonical_url TEXT,
  h1_count INTEGER NOT NULL DEFAULT 0,
  word_count INTEGER NOT NULL DEFAULT 0,
  internal_links INTEGER NOT NULL DEFAULT 0,
  images INTEGER NOT NULL DEFAULT 0,
  images_missing_alt INTEGER NOT NULL DEFAULT 0,
  has_schema INTEGER NOT NULL DEFAULT 0,
  is_indexable INTEGER NOT NULL DEFAULT 1,
  in_sitemap INTEGER NOT NULL DEFAULT 0,
  UNIQUE(run_id, url)
);

CREATE INDEX IF NOT EXISTS idx_seo_audit_pages_page
  ON seo_audit_pages(page_id, run_id DESC);

CREATE TABLE IF NOT EXISTS seo_audit_findings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER NOT NULL REFERENCES seo_audit_runs(id) ON DELETE CASCADE,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  page_id INTEGER REFERENCES pages(id) ON DELETE SET NULL,
  page_url TEXT,
  severity TEXT NOT NULL CHECK (severity IN ('critical', 'warning', 'opportunity')),
  rule_key TEXT NOT NULL,
  title TEXT NOT NULL,
  details TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_seo_audit_findings_run_severity
  ON seo_audit_findings(run_id, severity, rule_key);
CREATE INDEX IF NOT EXISTS idx_seo_audit_findings_page
  ON seo_audit_findings(page_id, run_id DESC);
