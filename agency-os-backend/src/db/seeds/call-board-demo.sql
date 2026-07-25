-- Local-only demo data for the Call Board.
-- Safe to rerun: it only resets leads tagged with source='call-board-seed'.

BEGIN TRANSACTION;

DELETE FROM callbacks
WHERE lead_id IN (SELECT id FROM leads WHERE source = 'call-board-seed');

DELETE FROM demos
WHERE lead_id IN (SELECT id FROM leads WHERE source = 'call-board-seed');

DELETE FROM session_leads
WHERE lead_id IN (SELECT id FROM leads WHERE source = 'call-board-seed');

INSERT OR IGNORE INTO leads (company, phone, source)
VALUES
  ('Seed Call Board - Fox River Plumbing', '(920) 555-0101', 'call-board-seed'),
  ('Seed Call Board - Bay Heating Pros', '(920) 555-0102', 'call-board-seed'),
  ('Seed Call Board - Ashwaubenon Electric', '(920) 555-0103', 'call-board-seed'),
  ('Seed Call Board - De Pere Drain Service', '(920) 555-0104', 'call-board-seed'),
  ('Seed Call Board - Appleton Roof Care', '(920) 555-0105', 'call-board-seed'),
  ('Seed Call Board - Howard Home Services', '(920) 555-0106', 'call-board-seed'),
  ('Seed Call Board - Suamico Mechanical', '(920) 555-0107', 'call-board-seed'),
  ('Seed Call Board - Titletown Contractors', '(920) 555-0108', 'call-board-seed'),
  ('Seed Call Board - Green Bay Sewer Repair', '(920) 555-0109', 'call-board-seed'),
  ('Seed Call Board - Neenah Remodel Group', '(920) 555-0110', 'call-board-seed'),
  ('Seed Call Board - Pulaski Plumbing', '(920) 555-0111', 'call-board-seed'),
  ('Seed Call Board - Allouez HVAC', '(920) 555-0112', 'call-board-seed');

UPDATE leads SET
  contact = 'Morgan',
  email = 'morgan@example.com',
  industry = 'plumber',
  city = 'Green Bay',
  state = 'WI',
  address = '100 Demo Ave',
  gbp_claimed = 1,
  gbp_completeness = 58,
  gbp_photos_count = 8,
  google_rating = 4.4,
  google_review_count = 37,
  has_website = 0,
  opportunity_score = 86,
  opportunity_reasoning = 'Strong map-pack opportunity, thin web presence, and several review snippets about emergency calls.',
  recommended_tier = 3,
  enrichment_status = 'enriched',
  status = 'cold',
  outcome = NULL,
  followup = NULL,
  notes = 'Seed card: fresh queue. Good first-call target.',
  pipeline_status = 'awaiting_build',
  pipeline_sessions = 0,
  pipeline_last_action_at = NULL,
  pitch_card_text = 'Open with the missed local-search opportunity: emergency plumbing intent is high, but the business has no dedicated landing page to catch it.',
  pitch_card_generated_at = datetime('now'),
  last_called_at = NULL,
  demo_booked_at = NULL,
  demo_scheduled_for = NULL,
  deleted_at = NULL,
  updated_at = datetime('now')
WHERE company = 'Seed Call Board - Fox River Plumbing';

UPDATE leads SET
  contact = 'Taylor',
  email = 'taylor@example.com',
  industry = 'hvac_contractor',
  city = 'Appleton',
  state = 'WI',
  address = '101 Demo Ave',
  gbp_claimed = 1,
  gbp_completeness = 62,
  gbp_photos_count = 14,
  google_rating = 4.7,
  google_review_count = 52,
  has_website = 0,
  opportunity_score = 79,
  opportunity_reasoning = 'Good reviews, weak owned-site conversion path, and seasonal tune-up pages would be an easy wedge.',
  recommended_tier = 2,
  enrichment_status = 'enriched',
  status = 'cold',
  notes = 'Seed card: another fresh queue example.',
  pipeline_status = 'awaiting_build',
  pipeline_sessions = 0,
  pitch_card_text = 'Lead with pre-winter tune-up demand and the missing path from Google search to booked calls.',
  pitch_card_generated_at = datetime('now'),
  last_called_at = NULL,
  demo_booked_at = NULL,
  demo_scheduled_for = NULL,
  deleted_at = NULL,
  updated_at = datetime('now')
WHERE company = 'Seed Call Board - Bay Heating Pros';

UPDATE leads SET
  contact = 'Casey',
  email = 'casey@example.com',
  industry = 'electrician',
  city = 'De Pere',
  state = 'WI',
  address = '102 Demo Ave',
  gbp_claimed = 0,
  gbp_completeness = 41,
  gbp_photos_count = 3,
  google_rating = 4.2,
  google_review_count = 19,
  has_website = 0,
  opportunity_score = 74,
  opportunity_reasoning = 'Unclaimed/underbuilt profile plus service-area search demand creates a simple visibility story.',
  recommended_tier = 2,
  enrichment_status = 'enriched',
  status = 'cold',
  notes = 'Seed card: unclaimed profile angle.',
  pipeline_status = 'awaiting_build',
  pipeline_sessions = 0,
  pitch_card_text = 'Ask whether they would be opposed to seeing how much De Pere electrical search demand they are missing.',
  pitch_card_generated_at = datetime('now'),
  last_called_at = NULL,
  demo_booked_at = NULL,
  demo_scheduled_for = NULL,
  deleted_at = NULL,
  updated_at = datetime('now')
WHERE company = 'Seed Call Board - Ashwaubenon Electric';

UPDATE leads SET
  contact = 'Jamie',
  email = 'jamie@example.com',
  industry = 'plumber',
  city = 'De Pere',
  state = 'WI',
  address = '103 Demo Ave',
  gbp_claimed = 1,
  google_rating = 4.6,
  google_review_count = 44,
  has_website = 1,
  opportunity_score = 82,
  opportunity_reasoning = 'Existing site is slow and thin; callback requested after pricing question.',
  recommended_tier = 3,
  enrichment_status = 'enriched',
  status = 'contacted',
  outcome = 'callback',
  followup = date('now'),
  notes = 'Seed card: asked to reconnect today after checking with the owner.',
  pipeline_status = 'sent_no_reply',
  pipeline_sessions = 0,
  pitch_card_text = 'They already asked about pricing. Re-anchor on monthly call value and faster map visibility.',
  pitch_card_generated_at = datetime('now'),
  last_called_at = datetime('now', '-3 days'),
  demo_booked_at = NULL,
  demo_scheduled_for = NULL,
  deleted_at = NULL,
  updated_at = datetime('now')
WHERE company = 'Seed Call Board - De Pere Drain Service';

UPDATE leads SET
  contact = 'Riley',
  email = 'riley@example.com',
  industry = 'roofing_contractor',
  city = 'Appleton',
  state = 'WI',
  address = '104 Demo Ave',
  gbp_claimed = 1,
  google_rating = 4.8,
  google_review_count = 91,
  has_website = 1,
  opportunity_score = 88,
  opportunity_reasoning = 'High review count but weak city-page footprint. Follow-up is overdue.',
  recommended_tier = 3,
  enrichment_status = 'enriched',
  status = 'contacted',
  outcome = 'callback',
  followup = date('now', '-1 day'),
  notes = 'Seed card: overdue follow-up, asked for examples of nearby roofing pages.',
  pipeline_status = 'sent_no_reply',
  pipeline_sessions = 0,
  pitch_card_text = 'Open with the Appleton roof-repair page gap and offer to show the sample site in 30 seconds.',
  pitch_card_generated_at = datetime('now'),
  last_called_at = datetime('now', '-5 days'),
  demo_booked_at = NULL,
  demo_scheduled_for = NULL,
  deleted_at = NULL,
  updated_at = datetime('now')
WHERE company = 'Seed Call Board - Appleton Roof Care';

UPDATE leads SET
  contact = 'Avery',
  email = 'avery@example.com',
  industry = 'general_contractor',
  city = 'Howard',
  state = 'WI',
  address = '105 Demo Ave',
  gbp_claimed = 1,
  google_rating = 4.5,
  google_review_count = 28,
  has_website = 1,
  opportunity_score = 71,
  opportunity_reasoning = 'Interested but asked for a follow-up after a job walk.',
  recommended_tier = 2,
  enrichment_status = 'enriched',
  status = 'contacted',
  outcome = 'callback',
  followup = date('now', '+3 days'),
  notes = 'Seed card: out of your face until the promised callback date.',
  pipeline_status = 'sent_no_reply',
  pipeline_sessions = 0,
  pitch_card_text = 'When due, ask if they would be opposed to seeing the Howard remodeling page angle.',
  pitch_card_generated_at = datetime('now'),
  last_called_at = datetime('now', '-2 days'),
  demo_booked_at = NULL,
  demo_scheduled_for = NULL,
  deleted_at = NULL,
  updated_at = datetime('now')
WHERE company = 'Seed Call Board - Howard Home Services';

UPDATE leads SET
  contact = 'Jordan',
  email = 'jordan@example.com',
  industry = 'hvac_contractor',
  city = 'Suamico',
  state = 'WI',
  address = '106 Demo Ave',
  gbp_claimed = 1,
  google_rating = 4.3,
  google_review_count = 31,
  has_website = 0,
  opportunity_score = 77,
  opportunity_reasoning = 'Future callback after owner returns from vacation.',
  recommended_tier = 2,
  enrichment_status = 'enriched',
  status = 'contacted',
  outcome = 'callback',
  followup = date('now', '+7 days'),
  notes = 'Seed card: waiting lane sample.',
  pipeline_status = 'sent_no_reply',
  pipeline_sessions = 0,
  pitch_card_text = 'Keep it light: they asked for next week, so preserve trust and resume with the same hook.',
  pitch_card_generated_at = datetime('now'),
  last_called_at = datetime('now', '-1 day'),
  demo_booked_at = NULL,
  demo_scheduled_for = NULL,
  deleted_at = NULL,
  updated_at = datetime('now')
WHERE company = 'Seed Call Board - Suamico Mechanical';

UPDATE leads SET
  contact = 'Sam',
  email = 'sam@example.com',
  industry = 'general_contractor',
  city = 'Green Bay',
  state = 'WI',
  address = '107 Demo Ave',
  gbp_claimed = 1,
  google_rating = 4.9,
  google_review_count = 64,
  has_website = 1,
  opportunity_score = 93,
  opportunity_reasoning = 'Clicked the custom site twice and spent time on the estimate CTA.',
  recommended_tier = 3,
  enrichment_status = 'enriched',
  status = 'contacted',
  outcome = 'engaged',
  followup = NULL,
  notes = 'Seed card: warm engaged lead with tracked site visits.',
  pipeline_status = 'engaged',
  site_url = 'https://example.com/titletown-contractors-demo',
  pipeline_sessions = 3,
  pipeline_last_action_at = datetime('now', '-2 hours'),
  pitch_card_text = 'They already looked at the demo site. Ask if it would be crazy to walk through what customers would see before calling.',
  pitch_card_generated_at = datetime('now'),
  last_called_at = datetime('now', '-1 day'),
  demo_booked_at = NULL,
  demo_scheduled_for = NULL,
  deleted_at = NULL,
  updated_at = datetime('now')
WHERE company = 'Seed Call Board - Titletown Contractors';

UPDATE leads SET
  contact = 'Dana',
  email = 'dana@example.com',
  industry = 'plumber',
  city = 'Green Bay',
  state = 'WI',
  address = '108 Demo Ave',
  gbp_claimed = 1,
  google_rating = 4.1,
  google_review_count = 22,
  has_website = 0,
  opportunity_score = 84,
  opportunity_reasoning = 'Had a real conversation about sewer repair calls and wants a booking link.',
  recommended_tier = 3,
  enrichment_status = 'enriched',
  status = 'qualified',
  outcome = 'warm conversation',
  followup = NULL,
  notes = 'Seed card: warm conversation moving toward a booked demo.',
  pipeline_status = 'engaged',
  site_url = 'https://example.com/green-bay-sewer-repair-demo',
  pipeline_sessions = 2,
  pipeline_last_action_at = datetime('now', '-5 hours'),
  pitch_card_text = 'Build from the sewer repair conversation. Keep the next ask narrow: look at the page and pick a demo time.',
  pitch_card_generated_at = datetime('now'),
  last_called_at = datetime('now', '-2 days'),
  demo_booked_at = NULL,
  demo_scheduled_for = NULL,
  deleted_at = NULL,
  updated_at = datetime('now')
WHERE company = 'Seed Call Board - Green Bay Sewer Repair';

UPDATE leads SET
  contact = 'Robin',
  email = 'robin@example.com',
  industry = 'general_contractor',
  city = 'Neenah',
  state = 'WI',
  address = '109 Demo Ave',
  gbp_claimed = 1,
  google_rating = 4.7,
  google_review_count = 48,
  has_website = 1,
  opportunity_score = 90,
  opportunity_reasoning = 'Booked demo and needs HoneyBook handoff.',
  recommended_tier = 3,
  enrichment_status = 'enriched',
  status = 'qualified',
  outcome = 'booked',
  followup = NULL,
  notes = 'Seed card: booked demo waiting for handoff/outcome.',
  pipeline_status = 'booked',
  pipeline_sessions = 2,
  pipeline_last_action_at = datetime('now', '-1 day'),
  pitch_card_text = 'Demo is booked. Execution center still opens if you want to rehearse or log the outcome.',
  pitch_card_generated_at = datetime('now'),
  last_called_at = datetime('now', '-1 day'),
  demo_booked_at = datetime('now', '-1 day'),
  demo_scheduled_for = datetime('now', '+1 day', 'start of day', '+14 hours'),
  deleted_at = NULL,
  updated_at = datetime('now')
WHERE company = 'Seed Call Board - Neenah Remodel Group';

UPDATE leads SET
  contact = 'Quinn',
  email = 'quinn@example.com',
  industry = 'plumber',
  city = 'Pulaski',
  state = 'WI',
  address = '110 Demo Ave',
  gbp_claimed = 1,
  google_rating = 4.0,
  google_review_count = 17,
  has_website = 1,
  opportunity_score = 55,
  opportunity_reasoning = 'Declined after hearing the offer.',
  recommended_tier = 1,
  enrichment_status = 'enriched',
  status = 'not_interested',
  outcome = 'not_interested',
  followup = NULL,
  notes = 'Seed card: said no for now, archive unless they come back around.',
  pipeline_status = 'archived',
  pipeline_sessions = 0,
  pipeline_last_action_at = datetime('now', '-4 days'),
  pitch_card_text = 'Closed out as not interested.',
  pitch_card_generated_at = datetime('now'),
  last_called_at = datetime('now', '-4 days'),
  demo_booked_at = NULL,
  demo_scheduled_for = NULL,
  deleted_at = NULL,
  updated_at = datetime('now')
WHERE company = 'Seed Call Board - Pulaski Plumbing';

UPDATE leads SET
  contact = 'Skyler',
  email = 'skyler@example.com',
  industry = 'hvac_contractor',
  city = 'Allouez',
  state = 'WI',
  address = '111 Demo Ave',
  gbp_claimed = 1,
  google_rating = 3.9,
  google_review_count = 12,
  has_website = 0,
  opportunity_score = 49,
  opportunity_reasoning = 'Bad fit for now; not enough appetite to pursue.',
  recommended_tier = 1,
  enrichment_status = 'enriched',
  status = 'not_interested',
  outcome = 'not_interested',
  followup = NULL,
  notes = 'Seed card: second not-interested example.',
  pipeline_status = 'archived',
  pipeline_sessions = 0,
  pipeline_last_action_at = datetime('now', '-8 days'),
  pitch_card_text = 'Closed out as not interested.',
  pitch_card_generated_at = datetime('now'),
  last_called_at = datetime('now', '-8 days'),
  demo_booked_at = NULL,
  demo_scheduled_for = NULL,
  deleted_at = NULL,
  updated_at = datetime('now')
WHERE company = 'Seed Call Board - Allouez HVAC';

INSERT INTO callbacks (lead_id, due_date, block_hint, notes, status)
SELECT id, date('now'), 'morning', 'Reconnect today after owner review.', 'pending'
FROM leads WHERE company = 'Seed Call Board - De Pere Drain Service';

INSERT INTO callbacks (lead_id, due_date, block_hint, notes, status)
SELECT id, date('now', '-1 day'), 'evening', 'Overdue: send them the Appleton roofing page example.', 'pending'
FROM leads WHERE company = 'Seed Call Board - Appleton Roof Care';

INSERT INTO callbacks (lead_id, due_date, block_hint, notes, status)
SELECT id, date('now', '+3 days'), 'morning', 'Job walk first, then call back.', 'pending'
FROM leads WHERE company = 'Seed Call Board - Howard Home Services';

INSERT INTO callbacks (lead_id, due_date, block_hint, notes, status)
SELECT id, date('now', '+7 days'), 'evening', 'Owner back from vacation.', 'pending'
FROM leads WHERE company = 'Seed Call Board - Suamico Mechanical';

INSERT INTO demos (lead_id, scheduled_for, status, honeybook_confirmed, outcome_notes, interest_level)
SELECT id, datetime('now', '+1 day', 'start of day', '+14 hours'), 'booked', 1, 'HoneyBook handoff ready.', 'hot'
FROM leads WHERE company = 'Seed Call Board - Neenah Remodel Group';

COMMIT;
