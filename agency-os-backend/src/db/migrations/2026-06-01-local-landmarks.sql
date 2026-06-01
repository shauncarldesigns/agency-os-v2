-- Add extracted_local_landmarks column to leads.
-- Stores JSON array of sub-city geographic references mined from reviews
-- (neighborhoods, named districts, landmarks, roads, bridges, regions),
-- separate from extracted_service_areas which is now strictly city-level.
-- Used by per-city service-area page brief generation to seed local color.
ALTER TABLE leads ADD COLUMN extracted_local_landmarks TEXT;
