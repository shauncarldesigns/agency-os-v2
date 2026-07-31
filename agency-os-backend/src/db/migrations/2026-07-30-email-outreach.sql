CREATE TABLE IF NOT EXISTS email_sends (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id INTEGER NOT NULL REFERENCES leads(id),
  open_token TEXT NOT NULL UNIQUE,
  recipient TEXT NOT NULL,
  sender TEXT NOT NULL,
  reply_to TEXT,
  subject TEXT NOT NULL,
  template_key TEXT NOT NULL,
  text_body TEXT NOT NULL,
  html_body TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'resend',
  provider_message_id TEXT UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN (
      'pending', 'sent', 'delivered', 'opened', 'clicked',
      'delivery_delayed', 'bounced', 'complained', 'suppressed', 'failed'
    )),
  sent_at TEXT,
  delivered_at TEXT,
  opened_at TEXT,
  clicked_at TEXT,
  bounced_at TEXT,
  complained_at TEXT,
  failed_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_email_sends_lead_created
  ON email_sends (lead_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_sends_provider_message
  ON email_sends (provider_message_id);

CREATE TABLE IF NOT EXISTS email_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email_send_id INTEGER REFERENCES email_sends(id),
  provider_message_id TEXT,
  event_key TEXT NOT NULL UNIQUE,
  event_type TEXT NOT NULL,
  event_at TEXT NOT NULL,
  payload TEXT,
  received_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_email_events_send_time
  ON email_events (email_send_id, event_at DESC);

CREATE TABLE IF NOT EXISTS email_automations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id INTEGER NOT NULL UNIQUE REFERENCES leads(id),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'paused', 'completed', 'stopped', 'failed')),
  current_step TEXT NOT NULL DEFAULT 'review_wait'
    CHECK (current_step IN (
      'review_wait', 'signal_wait', 'final_wait', 'archive_wait', 'complete'
    )),
  branch TEXT
    CHECK (branch IS NULL OR branch IN ('no_open', 'opened_no_click', 'demo_clicked')),
  next_run_at TEXT,
  processing_at TEXT,
  initial_send_id INTEGER REFERENCES email_sends(id),
  followup_send_id INTEGER REFERENCES email_sends(id),
  final_send_id INTEGER REFERENCES email_sends(id),
  pending_subject TEXT,
  pending_text TEXT,
  paused_at TEXT,
  completed_at TEXT,
  stopped_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_email_automations_due
  ON email_automations (status, next_run_at)
  WHERE status = 'active';
