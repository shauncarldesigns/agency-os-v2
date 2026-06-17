-- Playbook — Phase 4a (call_log.objection_hits column)
--
-- Adds a JSON column to call_log capturing every objection chip the
-- operator tapped during a call: which one, when (offset from call start
-- in seconds), which path was picked for branching, and whether they
-- ultimately marked it Handled or Didn't-Land. Feeds the dashboard's
-- Objections Overview (Phase 5) — frequency + handled-rate stats.
--
-- Stored as text (JSON array). Null for old rows.
--
-- Run via: npx wrangler d1 execute agency-os-v2 --remote \
--   --file=src/db/migrations/2026-06-17-call-log-objection-hits.sql

ALTER TABLE call_log ADD COLUMN objection_hits TEXT;
