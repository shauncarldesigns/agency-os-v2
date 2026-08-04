ALTER TABLE growth_work_items ADD COLUMN brief_id INTEGER REFERENCES briefs(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_growth_work_items_brief ON growth_work_items(brief_id);
