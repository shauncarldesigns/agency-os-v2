-- Put every currently built lead that has not advanced beyond Ready to Send
-- behind the new operator review gate. This intentionally includes all Text
-- Outreach Ready to Send cards and all Email Outreach To Call cards; no
-- existing site is grandfathered as approved.

UPDATE leads
   SET pipeline_status = 'built_needs_review',
       updated_at = datetime('now')
 WHERE pipeline_status IN ('awaiting_build', 'ready_to_send')
   AND (
     COALESCE(trim(site_url), '') <> ''
     OR COALESCE(trim(site_url_raw), '') <> ''
   );

-- An email automation created before this gate must not send while its site
-- is awaiting review. Approval reactivates it through the normal scheduler.
UPDATE email_automations
   SET status = 'paused',
       paused_at = datetime('now'),
       next_run_at = NULL,
       updated_at = datetime('now')
 WHERE status = 'active'
   AND initial_send_id IS NULL
   AND lead_id IN (
     SELECT id FROM leads WHERE pipeline_status = 'built_needs_review'
   );
