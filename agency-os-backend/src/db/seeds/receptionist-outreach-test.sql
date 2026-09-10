-- Local-only lead for testing the complete Email Outreach -> receptionist flow.
-- Safe to rerun. This intentionally has no email so it appears in To Call.

INSERT INTO leads (company, phone, source)
SELECT 'Northstar Plumbing and Drain', '+1 920-660-9545', 'local-receptionist-flow-test'
WHERE NOT EXISTS (
  SELECT 1 FROM leads WHERE source = 'local-receptionist-flow-test'
);

UPDATE leads SET
  company = 'Northstar Plumbing and Drain',
  contact = 'Jordan',
  phone = '+1 920-660-9545',
  phone_e164 = '+19206609545',
  email = NULL,
  industry = 'Plumbing',
  city = 'Green Bay',
  state = 'WI',
  address = '142 Demo Street',
  gbp_claimed = 1,
  google_rating = 4.8,
  google_review_count = 64,
  has_website = 0,
  extracted_services = '["Drain cleaning","Water heater repair","Fixture installation","Emergency plumbing"]',
  extracted_service_areas = '["Green Bay","De Pere","Ashwaubenon"]',
  phone_route = 'call',
  phone_valid = 1,
  phone_line_type = 'landline',
  opportunity_score = 90,
  opportunity_reasoning = 'Dedicated local test lead for the website-to-receptionist call flow.',
  recommended_tier = 3,
  enrichment_status = 'enriched',
  status = 'cold',
  outcome = NULL,
  followup = NULL,
  notes = 'TEST RECORD — safe to reset or archive during receptionist flow testing.',
  pipeline_status = 'ready_to_send',
  site_url = 'https://receptionist-flow-test.agcy.dev/',
  site_url_raw = 'https://receptionist-flow-test.agcy.dev/',
  demo_site_status = 'live',
  pitch_card_text = 'TEST RECORD: Walk through any call approach, decline the website, and offer the automated receptionist.',
  pitch_card_generated_at = datetime('now'),
  last_called_at = NULL,
  receptionist_interested = 0,
  receptionist_interested_at = NULL,
  not_interested_reason = NULL,
  deleted_at = NULL,
  updated_at = datetime('now')
WHERE source = 'local-receptionist-flow-test';
