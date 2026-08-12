ALTER TABLE leads ADD COLUMN sms_suppressed INTEGER NOT NULL DEFAULT 0;
ALTER TABLE leads ADD COLUMN sms_suppressed_at TEXT;
ALTER TABLE leads ADD COLUMN sms_suppression_reason TEXT;

CREATE TABLE IF NOT EXISTS messaging_control (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  status TEXT NOT NULL DEFAULT 'off' CHECK (status IN ('off','starting','active','paused','error')),
  mode TEXT NOT NULL DEFAULT 'test' CHECK (mode IN ('test','production')),
  transport TEXT NOT NULL DEFAULT 'mock' CHECK (transport IN ('mock','twilio')),
  send_rate_seconds INTEGER NOT NULL DEFAULT 5,
  stop_requested INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT OR IGNORE INTO messaging_control (id) VALUES (1);

CREATE TABLE IF NOT EXISTS messaging_conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id INTEGER REFERENCES leads(id),
  phone_number TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'sms' CHECK (channel = 'sms'),
  ai_mode TEXT NOT NULL DEFAULT 'auto' CHECK (ai_mode IN ('auto','human','paused')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  needs_human INTEGER NOT NULL DEFAULT 0,
  needs_human_reason TEXT,
  unread_count INTEGER NOT NULL DEFAULT 0,
  is_test INTEGER NOT NULL DEFAULT 0,
  last_message_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_messaging_conversation_phone_test
  ON messaging_conversations(phone_number, is_test);
CREATE INDEX IF NOT EXISTS idx_messaging_conversation_activity
  ON messaging_conversations(last_message_at DESC);

CREATE TABLE IF NOT EXISTS messaging_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL REFERENCES messaging_conversations(id),
  direction TEXT NOT NULL CHECK (direction IN ('inbound','outbound')),
  sender TEXT NOT NULL,
  recipient TEXT NOT NULL,
  body TEXT NOT NULL,
  twilio_sid TEXT,
  twilio_status TEXT NOT NULL DEFAULT 'queued',
  twilio_error_code TEXT,
  twilio_error_description TEXT,
  sent_by TEXT NOT NULL CHECK (sent_by IN ('ai','shaun','system')),
  intent TEXT,
  idempotency_key TEXT,
  outreach_action TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_messaging_message_twilio_sid
  ON messaging_messages(twilio_sid) WHERE twilio_sid IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_messaging_message_idempotency
  ON messaging_messages(idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS messaging_ai_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL REFERENCES messaging_conversations(id),
  inbound_message_id INTEGER NOT NULL REFERENCES messaging_messages(id),
  intent TEXT NOT NULL,
  confidence REAL NOT NULL,
  script_key TEXT,
  generated_response TEXT,
  auto_sent INTEGER NOT NULL DEFAULT 0,
  escalated INTEGER NOT NULL DEFAULT 0,
  provider TEXT NOT NULL DEFAULT 'rules',
  model TEXT NOT NULL DEFAULT 'controlled-v1',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS messaging_scripts (
  script_key TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  body TEXT,
  approved INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT OR IGNORE INTO messaging_scripts (script_key,label,body,approved) VALUES
('initial','Initial text','Hey [Name], this is Shaun — I put together a homepage for [Company], no charge, just wanted you to see it: [demo link]. Take a look when you get a sec, curious what you think.',1),
('follow_up','Follow-up','Hey [Name], following up on that homepage I sent for [Company]. If you like it, here''s what it''d cost to make it live: [pricing link]. If it''s not the right time, no worries — just let me know.',1),
('price_question','Price question',NULL,0),
('who_is_this','Who is this',NULL,0),
('what_is_this','What is this',NULL,0),
('already_has_website','Already has website',NULL,0),
('positive_interest','Positive interest',NULL,0),
('wants_call','Wants call',NULL,0),
('not_interested','Not interested',NULL,0),
('follow_up_later','Follow up later',NULL,0),
('did_not_receive_link','Missing link',NULL,0),
('human_escalation','Human escalation acknowledgment',NULL,0);
