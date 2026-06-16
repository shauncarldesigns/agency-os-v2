-- Vocabulary refactor — Phase 0 of the calling dashboard build.
--
-- Two changes to lead status semantics:
--
-- 1. The qualify-flow target was 'client', meaning the lead got removed from
--    the calling pipeline as soon as a project was created. That conflated
--    "demo booked, project exists, awaiting outcome" with "signed and paying."
--    From now on:
--      - qualified — demo booked, prospect project exists, awaiting outcome
--      - client    — signed, has a building/live project (counts toward MRR)
--    The qualify endpoint in routes/leads.ts is changed to write 'qualified'.
--    Anyone currently sitting as status='client' with an attached project_id
--    was set there by the OLD qualify flow → migrate them to 'qualified'.
--
-- 2. 'dead' was being used for both churned former clients AND cold-called
--    leads who said no. The latter now use the new 'not_interested' value.
--    No status column constraint (it's TEXT) so this is a pure semantic
--    distinction the app code now respects.
--
-- Run via: npx wrangler d1 execute agency-os-v2 --remote \
--   --file=src/db/migrations/2026-06-14-vocabulary-refactor.sql

UPDATE leads
SET status = 'qualified', updated_at = datetime('now')
WHERE status = 'client' AND project_id IS NOT NULL;
