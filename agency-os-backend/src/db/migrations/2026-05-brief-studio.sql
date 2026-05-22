-- ============================================================================
-- Brief Studio migration — 2026-05
-- ============================================================================
-- Adds the columns needed for the Brief Studio model:
--   - briefs.page_id      → link page briefs to their page row (NULL for master)
--   - briefs.version      → version number per brief; supersedes_brief_id tracks chain
--   - briefs.tbd_count    → cached count of [TBD: ...] tokens for the editor chip
--   - briefs.updated_at   → mtime for the Brief Library list
--   - pages.billing_status → 'included' | 'add_on' | 'comp' for monthly billing rollup
--
-- Cleans up:
--   - drops brief_jobs (orphan since v2.1; the live data was just reset)
--   - drops idx_briefs_monthly (uniqueness on the dropped monthly_batch concept)
--   - adds idx_briefs_master_per_project (one current master per project)
--
-- ALTER TABLE ADD COLUMN is NOT idempotent on SQLite/D1. Run once.
-- ============================================================================

ALTER TABLE briefs ADD COLUMN page_id    INTEGER REFERENCES pages(id);
ALTER TABLE briefs ADD COLUMN version    INTEGER NOT NULL DEFAULT 1;
ALTER TABLE briefs ADD COLUMN tbd_count  INTEGER DEFAULT 0;
-- updated_at: ALTER ADD COLUMN can't use a non-constant default in SQLite,
-- so the column is nullable and INSERT/UPDATE statements explicitly set
-- datetime('now'). Existing rows get backfilled below.
ALTER TABLE briefs ADD COLUMN updated_at TEXT;
UPDATE briefs SET updated_at = COALESCE(generated_at, datetime('now')) WHERE updated_at IS NULL;

ALTER TABLE pages ADD COLUMN billing_status TEXT DEFAULT 'included';

DROP TABLE IF EXISTS brief_jobs;
DROP INDEX IF EXISTS idx_briefs_monthly;

CREATE UNIQUE INDEX IF NOT EXISTS idx_briefs_master_per_project
  ON briefs(project_id)
  WHERE kind = 'master' AND supersedes_brief_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_briefs_page ON briefs(page_id);
