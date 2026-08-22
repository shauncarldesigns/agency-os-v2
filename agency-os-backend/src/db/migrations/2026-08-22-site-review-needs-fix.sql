ALTER TABLE leads ADD COLUMN site_review_status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE leads ADD COLUMN site_review_reasons TEXT;
ALTER TABLE leads ADD COLUMN site_review_note TEXT;
ALTER TABLE leads ADD COLUMN site_review_updated_at TEXT;
ALTER TABLE leads ADD COLUMN site_review_approved_at TEXT;
