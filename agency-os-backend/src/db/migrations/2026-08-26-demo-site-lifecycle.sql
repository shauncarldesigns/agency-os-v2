-- Track the lifecycle of outreach demo sites separately from a prospect's
-- pre-existing website. Existing saved demo URLs are backfilled as live.
ALTER TABLE leads ADD COLUMN demo_site_status TEXT NOT NULL DEFAULT 'none';
ALTER TABLE leads ADD COLUMN demo_site_deleted_at TEXT;

UPDATE leads
   SET demo_site_status = CASE
     WHEN status = 'not_interested'
       OR (pipeline_status = 'archived' AND status NOT IN ('qualified', 'client'))
     THEN 'cleanup_needed'
     ELSE 'live'
   END
 WHERE COALESCE(NULLIF(TRIM(site_url_raw), ''), NULLIF(TRIM(site_url), ''), '') != '';

CREATE INDEX IF NOT EXISTS idx_leads_demo_site_status
  ON leads(demo_site_status)
  WHERE deleted_at IS NULL;

-- Saving/replacing a demo URL means a demo exists again.
CREATE TRIGGER IF NOT EXISTS leads_demo_site_saved
AFTER UPDATE OF site_url, site_url_raw ON leads
WHEN COALESCE(NULLIF(TRIM(NEW.site_url_raw), ''), NULLIF(TRIM(NEW.site_url), ''), '') != ''
 AND (OLD.site_url IS NOT NEW.site_url OR OLD.site_url_raw IS NOT NEW.site_url_raw)
BEGIN
  UPDATE leads
     SET demo_site_status = 'live', demo_site_deleted_at = NULL
   WHERE id = NEW.id;
END;

-- A declined prospect with a built demo always lands in the cleanup queue.
CREATE TRIGGER IF NOT EXISTS leads_demo_site_cleanup_on_decline
AFTER UPDATE OF status, pipeline_status ON leads
WHEN COALESCE(NULLIF(TRIM(NEW.site_url_raw), ''), NULLIF(TRIM(NEW.site_url), ''), '') != ''
 AND NEW.demo_site_status = 'live'
 AND (
   NEW.status = 'not_interested'
   OR (NEW.pipeline_status = 'archived' AND NEW.status NOT IN ('qualified', 'client'))
 )
BEGIN
  UPDATE leads SET demo_site_status = 'cleanup_needed' WHERE id = NEW.id;
END;
