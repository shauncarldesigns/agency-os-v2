-- Not Interested is an archive reason, never an active CRM stage. Backfill
-- old limbo records and enforce the invariant for every future write path.
UPDATE leads
   SET pipeline_status = 'archived',
       demo_site_status = CASE
         WHEN demo_site_status = 'deleted' THEN 'deleted'
         WHEN COALESCE(NULLIF(TRIM(site_url_raw), ''), NULLIF(TRIM(site_url), ''), '') != '' THEN 'cleanup_needed'
         ELSE 'none'
       END,
       updated_at = datetime('now')
 WHERE status = 'not_interested' AND deleted_at IS NULL;

UPDATE email_automations
   SET status = 'stopped', stopped_at = COALESCE(stopped_at, datetime('now')), updated_at = datetime('now')
 WHERE status IN ('active', 'paused')
   AND lead_id IN (SELECT id FROM leads WHERE status = 'not_interested');

UPDATE callbacks SET status = 'cancelled'
 WHERE status = 'pending'
   AND lead_id IN (SELECT id FROM leads WHERE status = 'not_interested');

CREATE TRIGGER IF NOT EXISTS leads_archive_not_interested
AFTER UPDATE OF status ON leads
WHEN NEW.status = 'not_interested' AND NEW.deleted_at IS NULL
BEGIN
  UPDATE leads
     SET pipeline_status = 'archived',
         demo_site_status = CASE
           WHEN demo_site_status = 'deleted' THEN 'deleted'
           WHEN COALESCE(NULLIF(TRIM(site_url_raw), ''), NULLIF(TRIM(site_url), ''), '') != '' THEN 'cleanup_needed'
           ELSE 'none'
         END,
         pipeline_last_action_at = datetime('now'), updated_at = datetime('now')
   WHERE id = NEW.id;
  UPDATE email_automations
     SET status = 'stopped', stopped_at = COALESCE(stopped_at, datetime('now')), updated_at = datetime('now')
   WHERE lead_id = NEW.id AND status IN ('active', 'paused');
  UPDATE callbacks SET status = 'cancelled'
   WHERE lead_id = NEW.id AND status = 'pending';
END;
