-- Growth includes three service-area pages per monthly contract cycle.
-- Normalize older Tier 3 rows that relied on the former UI fallback of five
-- or retained the original zero database default.
UPDATE projects
SET monthly_pages_target = 3,
    updated_at = datetime('now')
WHERE tier = 3
  AND monthly_pages_target IN (0, 5);
