-- Phone routing for Text Outreach vs Call Outreach.
-- Twilio Lookup v2 Line Type Intelligence populates these fields.

ALTER TABLE leads ADD COLUMN phone_e164 TEXT;
ALTER TABLE leads ADD COLUMN phone_valid INTEGER;
ALTER TABLE leads ADD COLUMN phone_line_type TEXT;
ALTER TABLE leads ADD COLUMN phone_carrier TEXT;
ALTER TABLE leads ADD COLUMN phone_route TEXT DEFAULT 'unknown';
ALTER TABLE leads ADD COLUMN phone_lookup_error TEXT;
ALTER TABLE leads ADD COLUMN phone_lookup_at TEXT;

CREATE INDEX IF NOT EXISTS idx_leads_phone_route ON leads(phone_route);
