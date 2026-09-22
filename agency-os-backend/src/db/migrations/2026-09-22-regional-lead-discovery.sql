-- Stage newly discovered leads until the operator explicitly admits them to outreach.
-- Existing leads remain enabled so deployment does not interrupt current campaigns.
ALTER TABLE leads ADD COLUMN outreach_enabled INTEGER NOT NULL DEFAULT 1;

CREATE INDEX IF NOT EXISTS idx_leads_outreach_enabled
  ON leads(outreach_enabled, deleted_at, pipeline_status);
