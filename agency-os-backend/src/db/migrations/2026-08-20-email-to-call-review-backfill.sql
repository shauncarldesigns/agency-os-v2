-- Follow-up review-gate backfill for legacy Email Outreach rows.
--
-- Email Outreach derives its To Call column from a finished site plus a
-- missing/invalid email address. Some legacy rows still carry sent_no_reply,
-- so the original ready_to_send backfill did not select them. No historical
-- review existed before site_approved; these rows must be reviewed explicitly.

UPDATE leads AS target
   SET pipeline_status = 'built_needs_review',
       updated_at = datetime('now')
 WHERE target.id IN (
   SELECT l.id
     FROM leads l
    WHERE l.deleted_at IS NULL
      AND l.status IN ('cold', 'contacted')
      AND l.pipeline_status = 'sent_no_reply'
      AND l.enrichment_status = 'enriched'
      AND COALESCE(l.has_website, 0) = 0
      AND lower(COALESCE(l.outcome, '')) NOT LIKE '%not interested%'
      AND l.phone_route = 'call'
      AND (
        COALESCE(trim(l.site_url), '') <> ''
        OR COALESCE(trim(l.site_url_raw), '') <> ''
      )
      AND (
        COALESCE(trim(l.email), '') = ''
        OR instr(lower(trim(l.email)), '@') = 0
        OR lower(substr(trim(l.email), instr(trim(l.email), '@') + 1)) NOT LIKE '%.%'
        OR lower(substr(trim(l.email), instr(trim(l.email), '@') + 1)) IN (
          'example.com', 'example.org', 'example.net', 'test.com',
          'gmal.com', 'gmial.com', 'gmai.com', 'gmail.co',
          'hotmal.com', 'outlok.com'
        )
      )
      AND NOT EXISTS (
        SELECT 1 FROM projects p WHERE p.lead_id = l.id
      )
      AND NOT EXISTS (
        SELECT 1
          FROM demos d
         WHERE d.lead_id = l.id
           AND d.status IN ('booked', 'held', 'rescheduled')
      )
      AND NOT EXISTS (
        SELECT 1
          FROM lead_activity a
         WHERE a.lead_id = l.id
           AND a.action = 'site_approved'
      )
 );

-- Defensive stop: nothing awaiting review should have active email delivery.
UPDATE email_automations
   SET status = 'paused',
       paused_at = datetime('now'),
       next_run_at = NULL,
       updated_at = datetime('now')
 WHERE status = 'active'
   AND lead_id IN (
     SELECT id FROM leads WHERE pipeline_status = 'built_needs_review'
   );
