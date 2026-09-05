-- Calls an operator identifies as tests or false starts stay in call history,
-- but must not be re-added to Sales Intelligence by a later backfill.
CREATE TABLE IF NOT EXISTS call_intelligence_exclusions (
  call_id INTEGER PRIMARY KEY REFERENCES call_log(id) ON DELETE CASCADE,
  reason TEXT NOT NULL DEFAULT 'operator_removed',
  excluded_at TEXT NOT NULL DEFAULT (datetime('now'))
);

