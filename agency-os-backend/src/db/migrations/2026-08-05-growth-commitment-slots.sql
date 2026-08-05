ALTER TABLE growth_work_items ADD COLUMN work_tier TEXT NOT NULL DEFAULT 'committed'
  CHECK (work_tier IN ('committed', 'bonus'));

-- Preserve the first three page actions in each existing monthly cycle as the
-- commitment. Everything beyond that remains available as additional work.
WITH ranked AS (
  SELECT id,
    ROW_NUMBER() OVER (PARTITION BY cycle_id ORDER BY created_at, id) AS slot
  FROM growth_work_items
  WHERE category IN ('created', 'improved', 'technical', 'conversion')
)
UPDATE growth_work_items
SET work_tier = 'bonus'
WHERE id IN (SELECT id FROM ranked WHERE slot > 3);

CREATE INDEX IF NOT EXISTS idx_growth_work_items_cycle_tier_status
  ON growth_work_items(cycle_id, work_tier, status);
