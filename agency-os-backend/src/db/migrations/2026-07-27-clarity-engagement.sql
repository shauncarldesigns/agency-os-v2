-- Clarity engagement scoring for the Text Outreach demo-site funnel.
--
-- `opportunity_score` answers "is this a good business to prospect?"
-- `engagement_score` answers "how interested did they look after seeing the demo?"

ALTER TABLE leads ADD COLUMN engagement_score INTEGER NOT NULL DEFAULT 0;
ALTER TABLE leads ADD COLUMN engagement_grade TEXT NOT NULL DEFAULT 'nurture';
ALTER TABLE leads ADD COLUMN engagement_reasons TEXT;
ALTER TABLE leads ADD COLUMN clarity_last_sync_at TEXT;
ALTER TABLE leads ADD COLUMN clarity_last_error TEXT;

CREATE INDEX IF NOT EXISTS idx_leads_engagement_score
  ON leads(engagement_score)
  WHERE deleted_at IS NULL;
