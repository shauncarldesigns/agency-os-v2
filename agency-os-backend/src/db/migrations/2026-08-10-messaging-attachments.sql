ALTER TABLE messaging_messages ADD COLUMN attachments_json TEXT;

CREATE TABLE IF NOT EXISTS messaging_attachments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL REFERENCES messaging_conversations(id),
  message_id INTEGER REFERENCES messaging_messages(id),
  public_token TEXT NOT NULL UNIQUE,
  r2_key TEXT NOT NULL UNIQUE,
  file_name TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_messaging_attachments_conversation
  ON messaging_attachments(conversation_id, created_at);
