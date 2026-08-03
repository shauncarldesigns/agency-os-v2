-- Real-time enrichment progress shown in the lead pipeline.
ALTER TABLE leads ADD COLUMN enrichment_stage TEXT;
ALTER TABLE leads ADD COLUMN enrichment_progress INTEGER NOT NULL DEFAULT 0;
