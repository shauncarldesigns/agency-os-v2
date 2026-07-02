-- Demos — interest_level (operator's read of prospect temperature at booking)
--
-- Captured in the BookingPane at the moment the operator hits "Mark booked
-- & advance". Surfaces on Priority Strip demo cards and on the linked
-- call_log entry's notes so the temperature is visible before the demo
-- call is dialed.
--
-- Values: 'hot' | 'warm' | 'cold'. Nullable on pre-feature rows.
--
-- Run via: npx wrangler d1 execute agency-os-v2 --remote \
--   --file=src/db/migrations/2026-07-02-demos-interest-level.sql

ALTER TABLE demos ADD COLUMN interest_level TEXT
  CHECK (interest_level IN ('hot','warm','cold') OR interest_level IS NULL);
