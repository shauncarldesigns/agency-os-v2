-- Move existing cold leads whose text sequence was already exhausted into
-- Email Outreach -> To Call. Future handoffs happen inline when the final
-- nudge is recorded; this migration covers sequences completed beforehand.

INSERT INTO lead_activity (lead_id, action, from_status, to_status, meta)
SELECT l.id,
       'text_outreach_handoff',
       l.pipeline_status,
       l.pipeline_status,
       json_object(
         'reason', 'no_text_engagement',
         'previous_phone_route', l.phone_route,
         'backfilled', 1
       )
  FROM leads AS l
 WHERE l.deleted_at IS NULL
   AND COALESCE(l.phone_route, 'unknown') IN ('unknown', 'text')
   AND l.pipeline_status = 'sent_no_reply'
   AND l.status IN ('cold', 'contacted')
   AND (
     SELECT COUNT(*)
       FROM lead_activity AS followup_activity
      WHERE followup_activity.lead_id = l.id
        AND followup_activity.action = 'followed_up'
        AND followup_activity.from_status = 'sent_no_reply'
        AND NOT EXISTS (
          SELECT 1
            FROM lead_activity AS undo_activity
           WHERE undo_activity.action = 'undo'
             AND json_extract(undo_activity.meta, '$.undid_activity_id') = followup_activity.id
        )
   ) >= 2
   AND NOT EXISTS (
     SELECT 1
       FROM lead_activity AS existing_handoff
      WHERE existing_handoff.lead_id = l.id
        AND (
          existing_handoff.action = 'text_outreach_handoff'
          OR (
            existing_handoff.action = 'followed_up'
            AND json_extract(existing_handoff.meta, '$.text_outreach_handoff') = 1
          )
        )
   );

UPDATE leads
   SET phone_route = 'call',
       notes = CASE
         WHEN COALESCE(trim(notes), '') = ''
           THEN '[Text outreach completed — no response] Intro, reminder, and final nudge sent. Moved to Email Outreach → To Call to capture an email address.'
         ELSE '[Text outreach completed — no response] Intro, reminder, and final nudge sent. Moved to Email Outreach → To Call to capture an email address.' || char(10) || char(10) || notes
       END,
       updated_at = datetime('now')
 WHERE id IN (
   SELECT lead_id
     FROM lead_activity
    WHERE action = 'text_outreach_handoff'
      AND json_extract(meta, '$.backfilled') = 1
 )
   AND COALESCE(phone_route, 'unknown') IN ('unknown', 'text');
