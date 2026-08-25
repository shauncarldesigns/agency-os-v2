ALTER TABLE leads ADD COLUMN receptionist_interested INTEGER NOT NULL DEFAULT 0;
ALTER TABLE leads ADD COLUMN receptionist_interested_at TEXT;

CREATE INDEX IF NOT EXISTS idx_leads_receptionist_interested
  ON leads(receptionist_interested, receptionist_interested_at)
  WHERE receptionist_interested = 1 AND deleted_at IS NULL;
