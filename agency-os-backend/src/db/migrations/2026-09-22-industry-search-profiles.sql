-- Preserve the exact Google search phrase used while candidates retain their
-- stable parent industry label.
ALTER TABLE prospect_search_runs ADD COLUMN search_keyword TEXT;
