-- DNS Management — Phase 1 (schema only, no behavior yet)
--
-- Adds the data model for the Cloudflare DNS Management feature. Live records
-- (record IDs from the Cloudflare API) intentionally NOT stored — they're
-- fetched on demand from CF in the /status endpoint to avoid a caching layer
-- we'd have to invalidate.
--
-- The existing `cf_zone_id` column on projects is REUSED for this feature;
-- not adding a duplicate `cloudflare_zone_id`.
--
-- Run via: npx wrangler d1 execute agency-os-v2 --remote --file=src/db/migrations/2026-06-14-dns-management.sql

ALTER TABLE projects ADD COLUMN domain TEXT;
ALTER TABLE projects ADD COLUMN cf_nameservers TEXT;        -- JSON array of nameserver strings, populated after zone creation
ALTER TABLE projects ADD COLUMN dns_status TEXT NOT NULL DEFAULT 'not_created'; -- not_created | pending | active | failed
ALTER TABLE projects ADD COLUMN dns_last_checked TEXT;
ALTER TABLE projects ADD COLUMN registrar TEXT;
ALTER TABLE projects ADD COLUMN domain_owner_email TEXT;

-- Index lets the hourly cron cheaply find pending zones to poll.
CREATE INDEX IF NOT EXISTS idx_projects_dns_pending ON projects(dns_status) WHERE dns_status = 'pending';
