-- Call Sales Intelligence. Safe to apply before provider credentials are set:
-- processing remains disabled unless CALL_INTELLIGENCE_ENABLED=true.
CREATE TABLE IF NOT EXISTS call_intelligence_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  call_id INTEGER NOT NULL REFERENCES call_log(id) ON DELETE CASCADE,
  requested_prompt_version TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','transcribing','analyzing','completed','failed')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  locked_at TEXT,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  started_at TEXT,
  completed_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(call_id, requested_prompt_version)
);
CREATE INDEX IF NOT EXISTS idx_call_intelligence_jobs_status
  ON call_intelligence_jobs(status, created_at);

CREATE TABLE IF NOT EXISTS call_transcripts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  call_id INTEGER NOT NULL UNIQUE REFERENCES call_log(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  language TEXT,
  duration_seconds REAL,
  shaun_speaker INTEGER,
  transcript_json TEXT NOT NULL,
  transcript_text TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS call_analyses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  call_id INTEGER NOT NULL REFERENCES call_log(id) ON DELETE CASCADE,
  transcript_id INTEGER NOT NULL REFERENCES call_transcripts(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  analysis_prompt_version TEXT NOT NULL,
  analysis_schema_version TEXT NOT NULL,
  analysis_json TEXT NOT NULL,
  call_type TEXT NOT NULL,
  outcome TEXT NOT NULL,
  outcome_confidence REAL,
  overall_score INTEGER,
  recommended_next_action TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  superseded_at TEXT,
  UNIQUE(call_id, analysis_prompt_version, analysis_schema_version)
);
CREATE INDEX IF NOT EXISTS idx_call_analyses_current
  ON call_analyses(call_id, superseded_at, created_at DESC);

-- Proven reporting fields, rebuilt transactionally from validated JSON.
CREATE TABLE IF NOT EXISTS call_analysis_facts (
  analysis_id INTEGER NOT NULL REFERENCES call_analyses(id) ON DELETE CASCADE,
  call_id INTEGER NOT NULL REFERENCES call_log(id) ON DELETE CASCADE,
  fact_type TEXT NOT NULL CHECK (fact_type IN ('stated_need','inferred_need','objection','benefit_reaction','missed_question')),
  category TEXT NOT NULL,
  reaction TEXT,
  confidence REAL,
  quote TEXT,
  timestamp TEXT,
  PRIMARY KEY (analysis_id, fact_type, category, timestamp)
);
CREATE INDEX IF NOT EXISTS idx_call_analysis_facts_reporting
  ON call_analysis_facts(fact_type, category, reaction);
