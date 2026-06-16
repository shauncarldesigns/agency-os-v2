-- Calling Dashboard — Phase 2 (schema only, no behavior yet)
--
-- Adds the data model for the calling-session / demo-booking feature. All
-- live state (per-call outcome, per-demo status, callback due dates) lives
-- in these tables; the leads table only gets pointer columns for fast
-- composition queries (last_called_at for the 14-day exclusion, demo
-- pointers for the priority strip lookups).
--
-- The pitch_card_text column is intentionally nullable — existing 165
-- leads enriched before this feature aren't auto-backfilled. Operator
-- generates them on demand via the ↻ button in the execution view.
--
-- Run via: npx wrangler d1 execute agency-os-v2 --remote \
--   --file=src/db/migrations/2026-06-14-calling-dashboard.sql

-- ==================================================
-- SESSIONS — One calling block (morning / evening) per day
-- ==================================================
CREATE TABLE IF NOT EXISTS sessions (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  session_date      TEXT NOT NULL,                            -- ISO date (America/Chicago)
  block             TEXT NOT NULL,                            -- 'morning' | 'evening'
  industry          TEXT NOT NULL,
  geographic_filter TEXT,                                     -- JSON array of city names; null = full service area
  score_floor       INTEGER NOT NULL DEFAULT 50,
  lead_count_target INTEGER NOT NULL DEFAULT 40,
  status            TEXT NOT NULL DEFAULT 'planned',          -- planned | active | complete
  started_at        TEXT,
  completed_at      TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_session_unique ON sessions(session_date, block);
CREATE INDEX IF NOT EXISTS idx_session_status ON sessions(status);
-- Active-session-exclusivity is enforced in app logic, but this partial index
-- makes "is there an active session?" check trivial.
CREATE INDEX IF NOT EXISTS idx_session_active ON sessions(status) WHERE status = 'active';

-- ==================================================
-- SESSION_LEADS — M2M with per-call outcome
-- ==================================================
CREATE TABLE IF NOT EXISTS session_leads (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id    INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  lead_id       INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  position      INTEGER NOT NULL,                             -- ordering within session; callbacks pinned to top
  call_outcome  TEXT,                                          -- voicemail | not_interested | callback | booked | skipped; null = uncalled
  called_at     TEXT,
  is_callback   INTEGER NOT NULL DEFAULT 0                     -- bool — pinned-to-top callback flag
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_session_lead_unique ON session_leads(session_id, lead_id);
CREATE INDEX IF NOT EXISTS idx_session_lead_outcome ON session_leads(session_id, call_outcome);
-- "Next uncalled lead" is the hottest query during a session — partial index
-- keeps it cheap as the session grows.
CREATE INDEX IF NOT EXISTS idx_session_lead_next ON session_leads(session_id, position) WHERE call_outcome IS NULL;

-- ==================================================
-- CALLBACKS — Day-precision callback tracking
-- ==================================================
CREATE TABLE IF NOT EXISTS callbacks (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id       INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  due_date      TEXT NOT NULL,                                 -- ISO date
  block_hint    TEXT,                                          -- 'morning' | 'evening' | null
  notes         TEXT,
  status        TEXT NOT NULL DEFAULT 'pending',               -- pending | completed | missed
  completed_at  TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_callback_due ON callbacks(due_date, status);
CREATE INDEX IF NOT EXISTS idx_callback_lead ON callbacks(lead_id);
-- Pending callbacks dominate every query path; partial index keeps "what's
-- due on date X" cheap.
CREATE INDEX IF NOT EXISTS idx_callback_pending ON callbacks(due_date) WHERE status = 'pending';

-- ==================================================
-- DEMOS — Booked-demo lifecycle
-- ==================================================
CREATE TABLE IF NOT EXISTS demos (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id             INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  booked_at           TEXT NOT NULL DEFAULT (datetime('now')),
  scheduled_for       TEXT NOT NULL,                           -- ISO datetime — what the prospect agreed to
  status              TEXT NOT NULL DEFAULT 'booked',          -- booked | held | no_show | rescheduled
  honeybook_confirmed INTEGER NOT NULL DEFAULT 0,              -- bool — operator confirmed HB form submission
  outcome_notes       TEXT,
  status_set_at       TEXT,
  created_at          TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_demo_lead ON demos(lead_id);
CREATE INDEX IF NOT EXISTS idx_demo_status ON demos(status);
CREATE INDEX IF NOT EXISTS idx_demo_scheduled ON demos(scheduled_for);
-- "Awaiting status" priority-strip query: booked demos in the past.
CREATE INDEX IF NOT EXISTS idx_demo_awaiting ON demos(scheduled_for) WHERE status = 'booked';
-- "No-show recovery" priority-strip query: every no-show is potentially in
-- this queue until the operator marks it dialed.
CREATE INDEX IF NOT EXISTS idx_demo_noshow ON demos(status) WHERE status = 'no_show';

-- ==================================================
-- DEMO_EVENTS — Audit trail for the lifecycle
-- ==================================================
CREATE TABLE IF NOT EXISTS demo_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  demo_id     INTEGER NOT NULL REFERENCES demos(id) ON DELETE CASCADE,
  event_type  TEXT NOT NULL,                                   -- created | held | no_show | rescheduled
  event_data  TEXT,                                            -- JSON; reschedule events carry the new date here
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_demo_event_demo ON demo_events(demo_id, created_at);

-- ==================================================
-- WEEKLY_ROTATION — Single-row table holding rotation state
-- ==================================================
-- "What industry did we end on last week?" Persists across weeks so the
-- generate-week endpoint can pick up where we left off. Not env config so the
-- operator can mutate it without a redeploy.
CREATE TABLE IF NOT EXISTS weekly_rotation (
  id              INTEGER PRIMARY KEY CHECK (id = 1),          -- enforces single-row table
  last_industry   TEXT,                                        -- last industry the rotation served
  last_session_at TEXT,                                        -- when the last session ran
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT OR IGNORE INTO weekly_rotation (id) VALUES (1);

-- ==================================================
-- LEADS — Pointer columns for cheap composition + priority-strip queries
-- ==================================================
ALTER TABLE leads ADD COLUMN pitch_card_text TEXT;                -- Cached at first ↻ click; null = "generate me"
ALTER TABLE leads ADD COLUMN pitch_card_generated_at TEXT;
ALTER TABLE leads ADD COLUMN last_called_at TEXT;                 -- Drives 14-day exclusion in session composer
ALTER TABLE leads ADD COLUMN demo_booked_at TEXT;                 -- Quick-reference pointer to latest demo
ALTER TABLE leads ADD COLUMN demo_scheduled_for TEXT;             -- Quick-reference pointer to latest demo

-- Cheap "give me leads that haven't been called in 14 days" — most-hit
-- composition path. Partial index would also work but a full index is fine
-- here; nulls (never-called) sort first which is the desired behavior.
CREATE INDEX IF NOT EXISTS idx_leads_last_called ON leads(last_called_at);
