-- Local-only additive demo for the Email Outreach engaged column.
-- Safe to rerun: it only creates or refreshes this named example.

INSERT INTO leads (company, phone, source)
SELECT 'Email Preview - Warm Sales Call', '(920) 555-0115', 'call-board-seed'
WHERE NOT EXISTS (
  SELECT 1 FROM leads WHERE company = 'Email Preview - Warm Sales Call'
);

UPDATE leads SET
  contact = 'Taylor',
  email = 'taylor@example.com',
  industry = 'plumber',
  city = 'Green Bay',
  state = 'WI',
  address = '115 Demo Ave',
  gbp_claimed = 1,
  google_rating = 4.7,
  google_review_count = 52,
  has_website = 0,
  phone_route = 'call',
  phone_line_type = 'landline',
  opportunity_score = 88,
  opportunity_reasoning = 'The prospect opened the emailed concept site and returned to review it before the warm sales call.',
  recommended_tier = 3,
  enrichment_status = 'enriched',
  status = 'contacted',
  outcome = 'Email Captured',
  followup = NULL,
  notes = 'Seed card: engaged Email Outreach lead ready for the warm sales call flow.',
  pipeline_status = 'engaged',
  site_url = 'https://email-warm-call-demo.agcy.dev/?utm_source=email&utm_medium=outreach&utm_campaign=email-warm-call',
  site_url_raw = 'https://email-warm-call-demo.agcy.dev/',
  campaign_slug = 'email-warm-call',
  clarity_tag = 'lead-seed-email-warm-call',
  pipeline_brief = 'Seed brief for an Email Outreach prospect who engaged with the website concept and is ready for a sales call.',
  pipeline_sessions = 2,
  engagement_score = 75,
  engagement_grade = 'walkthrough',
  engagement_reasons = '["Opened emailed website concept","Returned for a second session","Viewed services and contact pages"]',
  pipeline_last_action_at = datetime('now', '-20 minutes'),
  pitch_card_text = 'They revisited the website concept from the email. Open the warm sales call and ask what stood out to them.',
  pitch_card_generated_at = datetime('now', '-1 day'),
  last_called_at = NULL,
  demo_booked_at = NULL,
  demo_scheduled_for = NULL,
  deleted_at = NULL,
  updated_at = datetime('now')
WHERE company = 'Email Preview - Warm Sales Call';

INSERT INTO lead_activity (lead_id, action, from_status, to_status, meta, created_at)
SELECT id, 'email_captured', 'ready_to_send', 'sent_no_reply',
       '{"email":"taylor@example.com","source":"local-seed"}',
       datetime('now', '-2 days')
FROM leads
WHERE company = 'Email Preview - Warm Sales Call'
  AND NOT EXISTS (
    SELECT 1 FROM lead_activity a
    WHERE a.lead_id = leads.id AND a.action = 'email_captured'
  );

INSERT INTO lead_activity (lead_id, action, from_status, to_status, meta, created_at)
SELECT id, 'email_sent', 'sent_no_reply', 'sent_no_reply',
       '{"template":"website-concept","source":"local-seed"}',
       datetime('now', '-1 day')
FROM leads
WHERE company = 'Email Preview - Warm Sales Call'
  AND NOT EXISTS (
    SELECT 1 FROM lead_activity a
    WHERE a.lead_id = leads.id AND a.action = 'email_sent'
  );

INSERT INTO lead_activity (lead_id, action, from_status, to_status, meta, created_at)
SELECT id, 'click_tracked', 'sent_no_reply', 'engaged',
       '{"channel":"email","url":"https://email-warm-call-demo.agcy.dev/","source":"local-seed"}',
       datetime('now', '-20 minutes')
FROM leads
WHERE company = 'Email Preview - Warm Sales Call'
  AND NOT EXISTS (
    SELECT 1 FROM lead_activity a
    WHERE a.lead_id = leads.id AND a.action = 'click_tracked'
  );
