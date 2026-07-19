-- Automated Pipeline (text + site outreach) — schema additions.
--
-- Adds a `pipeline_status` dimension to `leads` that is ORTHOGONAL to
-- the existing lifecycle `status` (cold/contacted/qualified/...). A lead
-- can simultaneously be 'contacted' in the cold-call motion AND
-- 'ready_to_send' in the automated motion; do not repurpose `status`.
--
-- Every existing lead is back-filled to 'awaiting_build' by the DEFAULT.
-- The Worker's list endpoint scopes the queue to the useful subset
-- (has_website=0 AND status IN ('cold','contacted') AND enriched).
--
-- ALTER TABLE ADD COLUMN is NOT idempotent in SQLite/D1 — if a column
-- already exists the statement errors. Run this exactly once per DB.

ALTER TABLE leads ADD COLUMN pipeline_status TEXT NOT NULL DEFAULT 'awaiting_build';
-- The UTM-tagged live URL. Source of truth for what gets texted.
ALTER TABLE leads ADD COLUMN site_url TEXT;
-- The URL as pasted by the operator, before UTM. Kept for reference /
-- future re-tagging without re-asking the operator.
ALTER TABLE leads ADD COLUMN site_url_raw TEXT;
-- Landingsite brief content. The existing `briefs` table is per-project
-- and shaped for master/homepage_demo/monthly_batch; a per-lead
-- pre-qualification brief is a different concept, so it lives on `leads`.
ALTER TABLE leads ADD COLUMN pipeline_brief TEXT;
-- Slugified business name for UTM campaign param; pre-computed at
-- site-url save time so reads don't have to re-slugify.
ALTER TABLE leads ADD COLUMN campaign_slug TEXT;
-- Clarity custom-tag id, passed into the landingsite `clarity('set',
-- 'lead', '{tag}')` call. Also used to reconcile Clarity Data Export
-- aggregates back to a lead.
ALTER TABLE leads ADD COLUMN clarity_tag TEXT;
-- Denormalized engagement counter. Bumped by the click-tracker (Layer 1,
-- reliable) and periodically by a Clarity sync (Layer 2, best-effort).
ALTER TABLE leads ADD COLUMN pipeline_sessions INTEGER NOT NULL DEFAULT 0;
-- Machine timestamp of the most recent pipeline action (site saved,
-- intro sent, followed up, called, click tracked). The display string
-- ("Sent 3 days ago") is derived client-side from this + activity.
ALTER TABLE leads ADD COLUMN pipeline_last_action_at TEXT;

-- Partial index on the default hot path: the operator viewing the queue
-- filters by pipeline_status. Non-terminal statuses only; a full index
-- would waste space on 'engaged' leads that also stay in the pool.
CREATE INDEX IF NOT EXISTS idx_leads_pipeline_status
  ON leads(pipeline_status)
  WHERE deleted_at IS NULL;

-- ============================================================================
-- lead_activity — audit trail + backing store for /undo.
-- ============================================================================
-- Every reversible action writes a row. `/api/pipeline/leads/:id/undo`
-- finds the latest non-undo activity for the lead, reverts its side-effect
-- (status change and/or field clear), and writes a matching 'undo' row.
-- 'click_tracked' rows are informational only and are NOT eligible for undo.
CREATE TABLE IF NOT EXISTS lead_activity (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id       INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  action        TEXT NOT NULL,       -- brief_generated | url_saved | intro_sent | followed_up | called | status_changed | click_tracked | undo
  from_status   TEXT,                -- pipeline_status before this action (nullable)
  to_status     TEXT,                -- pipeline_status after this action (nullable)
  meta          TEXT,                -- JSON blob (message body, url, ua, undo target, etc.)
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Recent-activity-per-lead is the dominant query (detail modal, undo). A
-- composite index keeps both use cases cheap without needing a separate one.
CREATE INDEX IF NOT EXISTS idx_lead_activity_lead
  ON lead_activity(lead_id, created_at DESC);
