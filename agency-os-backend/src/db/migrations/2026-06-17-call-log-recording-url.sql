-- Call log — recording_url (Loom-alternative audio capture feature)
--
-- Adds a nullable URL column to call_log. Populated when the operator
-- hits the in-cockpit Record button during a call; the captured audio
-- blob is uploaded to R2 (bucket: agency-os-recordings) and the public
-- pub-*.r2.dev URL is persisted here for later playback.
--
-- Null for any pre-feature row or any call where the operator didn't
-- record.
--
-- Run via: npx wrangler d1 execute agency-os-v2 --remote \
--   --file=src/db/migrations/2026-06-17-call-log-recording-url.sql

ALTER TABLE call_log ADD COLUMN recording_url TEXT;
