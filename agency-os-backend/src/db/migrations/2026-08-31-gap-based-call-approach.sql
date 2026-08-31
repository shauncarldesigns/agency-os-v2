-- Expand Email Outreach call tracking with the Gap-based approach.
-- SQLite cannot alter an existing CHECK constraint, so rebuild call_log while
-- preserving ids used by recordings and call-intelligence tables.
PRAGMA defer_foreign_keys = ON;

CREATE TABLE call_log_gap_based (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id         INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  outcome         TEXT NOT NULL,
  notes           TEXT NOT NULL,
  followup_date   TEXT,
  objection_hits  TEXT,
  call_approach   TEXT CHECK (call_approach IN ('direct', 'question_based', 'gap_based')),
  recording_url   TEXT,
  created_at      TEXT DEFAULT (datetime('now'))
);

INSERT INTO call_log_gap_based (
  id, lead_id, outcome, notes, followup_date, objection_hits,
  call_approach, recording_url, created_at
)
SELECT
  id, lead_id, outcome, notes, followup_date, objection_hits,
  call_approach, recording_url, created_at
FROM call_log;

DROP TABLE call_log;
ALTER TABLE call_log_gap_based RENAME TO call_log;

CREATE INDEX idx_call_lead ON call_log(lead_id, created_at DESC);
CREATE INDEX idx_call_log_approach
  ON call_log(call_approach, created_at DESC)
  WHERE call_approach IS NOT NULL;
