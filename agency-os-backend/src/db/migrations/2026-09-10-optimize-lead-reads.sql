-- Keep lead list ordering, Call Center selection, app-shell callback checks,
-- and activity undo resolution on indexed paths.
CREATE INDEX IF NOT EXISTS idx_leads_active_updated
  ON leads(updated_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_leads_deleted_updated
  ON leads(updated_at DESC)
  WHERE deleted_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_leads_call_center_company
  ON leads(company COLLATE NOCASE, id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_callback_pending_lead_due
  ON callbacks(lead_id, due_date)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_lead_activity_effective_latest
  ON lead_activity(lead_id, created_at DESC, id DESC)
  WHERE action != 'undo';

CREATE INDEX IF NOT EXISTS idx_lead_activity_undo_target
  ON lead_activity(CAST(json_extract(meta, '$.undid_activity_id') AS INTEGER))
  WHERE action = 'undo';
