-- Opt-in browser startup; existing queues and profiles are preserved.
ALTER TABLE builder_control ADD COLUMN browser_enabled INTEGER NOT NULL DEFAULT 0 CHECK (browser_enabled IN (0, 1));
