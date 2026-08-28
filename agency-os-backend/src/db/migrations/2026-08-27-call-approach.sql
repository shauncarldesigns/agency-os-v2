-- Track which Email Outreach call approach produced each call result.
ALTER TABLE call_log ADD COLUMN call_approach TEXT
  CHECK (call_approach IN ('direct', 'question_based'));

CREATE INDEX IF NOT EXISTS idx_call_log_approach
  ON call_log(call_approach, created_at DESC)
  WHERE call_approach IS NOT NULL;
