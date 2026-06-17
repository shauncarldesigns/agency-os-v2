-- Playbook — Phase 3 (generation log)
--
-- Logs every call to /api/playbook/generate-rebuttal: the request payload,
-- the variants Claude returned, the model used, the duration, and which
-- variant the operator picked (if any). Spec calls for DB-only storage now;
-- manual promotion of high-handled-rate variants to the markdown source is
-- a later operator workflow.
--
-- Run via: npx wrangler d1 execute agency-os-v2 --remote \
--   --file=src/db/migrations/2026-06-17-playbook-generations.sql

CREATE TABLE IF NOT EXISTS playbook_generations (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id             INTEGER REFERENCES leads(id) ON DELETE SET NULL,
  objection_id        TEXT NOT NULL,
  request_json        TEXT NOT NULL,                  -- full request body
  response_json       TEXT,                           -- full {variants:[...]} response (null on error)
  model               TEXT NOT NULL,
  used_variant_index  INTEGER,                        -- 0/1/2 once operator hits "Use this"; null until then
  duration_ms         INTEGER NOT NULL,
  status              TEXT NOT NULL,                  -- 'success' | 'parse_error' | 'api_error'
  error_message       TEXT,
  created_at          TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_playbook_gen_objection ON playbook_generations(objection_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_playbook_gen_lead ON playbook_generations(lead_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_playbook_gen_used ON playbook_generations(objection_id, used_variant_index) WHERE used_variant_index IS NOT NULL;
