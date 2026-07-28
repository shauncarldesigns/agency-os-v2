-- Temporarily suppress Clarity enrichment for a lead while known operator
-- test traffic ages out of the export API's rolling three-day window.
ALTER TABLE leads ADD COLUMN clarity_ignore_until TEXT;
