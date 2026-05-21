-- ============================================================================
-- Add opportunity_reasoning to leads — 2026-05-21
-- ============================================================================
-- Stores the joined factors string from calculateOpportunityScore so the
-- pipeline UI can show a hover breakdown without re-running scoring.
-- Not idempotent (ALTER TABLE ADD COLUMN errors if column exists). Run once.
-- ============================================================================

ALTER TABLE leads ADD COLUMN opportunity_reasoning TEXT;
