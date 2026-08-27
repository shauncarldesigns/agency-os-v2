ALTER TABLE leads ADD COLUMN not_interested_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_leads_not_interested_reason
  ON leads(not_interested_reason)
  WHERE status = 'not_interested' AND deleted_at IS NULL;
