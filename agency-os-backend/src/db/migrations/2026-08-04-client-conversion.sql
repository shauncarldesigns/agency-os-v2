-- Client workspace lifecycle: internal projects may use the client workspace
-- without contributing to client/MRR/conversion statistics.
ALTER TABLE projects ADD COLUMN is_internal INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_projects_internal
  ON projects(is_internal, status);
