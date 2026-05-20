-- Phase 7: per-project reporting integrations
-- Run this against any existing D1 database to bring it up to date with the new schema.

ALTER TABLE projects ADD COLUMN gsc_property_url TEXT;
ALTER TABLE projects ADD COLUMN cf_zone_id TEXT;
ALTER TABLE projects ADD COLUMN client_email TEXT;
