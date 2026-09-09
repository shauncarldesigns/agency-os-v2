CREATE TABLE IF NOT EXISTS voice_business_profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  profile_kind TEXT NOT NULL DEFAULT 'test' CHECK (profile_kind IN ('test','prospect','customer')),
  lead_id INTEGER REFERENCES leads(id) ON DELETE SET NULL,
  project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  business_name TEXT NOT NULL,
  business_phone TEXT,
  timezone TEXT NOT NULL DEFAULT 'America/Chicago',
  greeting TEXT NOT NULL,
  services_text TEXT NOT NULL DEFAULT '',
  service_area_text TEXT NOT NULL DEFAULT '',
  hours_text TEXT NOT NULL DEFAULT '',
  default_mode TEXT NOT NULL DEFAULT 'intake_only' CHECK (default_mode IN ('receptionist','after_hours','intake_only','bypass','paused')),
  transfer_enabled INTEGER NOT NULL DEFAULT 0,
  emergency_transfer_enabled INTEGER NOT NULL DEFAULT 0,
  private_transfer_destination TEXT,
  public_phone_number TEXT,
  retell_agent_id TEXT,
  retell_agent_version INTEGER,
  retell_knowledge_base_id TEXT,
  voice_id TEXT,
  notification_email TEXT NOT NULL DEFAULT 'info@shauncarldesigns.com',
  recording_retention_days INTEGER NOT NULL DEFAULT 30,
  configuration_json TEXT NOT NULL DEFAULT '{}',
  knowledge_sync_status TEXT NOT NULL DEFAULT 'not_started',
  knowledge_last_synced_at TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','testing','ready','live','paused','error')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (lead_id IS NULL OR project_id IS NULL),
  CHECK (private_transfer_destination IS NULL OR public_phone_number IS NULL OR private_transfer_destination != public_phone_number)
);
CREATE INDEX IF NOT EXISTS idx_voice_profiles_lead ON voice_business_profiles(lead_id);
CREATE INDEX IF NOT EXISTS idx_voice_profiles_project ON voice_business_profiles(project_id);

CREATE TABLE IF NOT EXISTS voice_demo_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  voice_business_profile_id INTEGER NOT NULL REFERENCES voice_business_profiles(id) ON DELETE CASCADE,
  prospect_id INTEGER REFERENCES leads(id) ON DELETE SET NULL,
  demo_phone_number TEXT,
  caller_phone_match TEXT,
  profile_snapshot_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','expired','completed','canceled')),
  activated_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,
  created_by TEXT NOT NULL DEFAULT 'Shaun',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_voice_demo_active ON voice_demo_sessions(caller_phone_match, status, expires_at);

CREATE TABLE IF NOT EXISTS voice_calls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  voice_business_profile_id INTEGER REFERENCES voice_business_profiles(id) ON DELETE SET NULL,
  prospect_id INTEGER REFERENCES leads(id) ON DELETE SET NULL,
  demo_session_id INTEGER REFERENCES voice_demo_sessions(id) ON DELETE SET NULL,
  retell_call_id TEXT NOT NULL UNIQUE,
  environment TEXT NOT NULL DEFAULT 'demo' CHECK (environment IN ('demo','live','mock')),
  direction TEXT NOT NULL DEFAULT 'inbound',
  from_number TEXT,
  to_number TEXT,
  mode_at_start TEXT,
  started_at TEXT,
  ended_at TEXT,
  duration_seconds INTEGER,
  disconnection_reason TEXT,
  call_successful INTEGER,
  sentiment TEXT,
  summary TEXT,
  transcript TEXT,
  recording_url TEXT,
  total_cost REAL,
  classification TEXT,
  final_outcome TEXT,
  raw_metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_voice_calls_profile ON voice_calls(voice_business_profile_id, created_at DESC);

CREATE TABLE IF NOT EXISTS voice_leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  voice_business_profile_id INTEGER NOT NULL REFERENCES voice_business_profiles(id) ON DELETE CASCADE,
  source_call_id INTEGER NOT NULL UNIQUE REFERENCES voice_calls(id) ON DELETE CASCADE,
  caller_name TEXT,
  caller_phone TEXT,
  caller_email TEXT,
  service_requested TEXT,
  service_address TEXT,
  city TEXT,
  postal_code TEXT,
  urgency TEXT NOT NULL DEFAULT 'unknown',
  preferred_timing TEXT,
  intake_notes TEXT,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','contacted','appointment','booked','won','lost','spam')),
  estimated_value REAL,
  confirmed_revenue REAL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_voice_leads_business_status
  ON voice_leads(voice_business_profile_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS voice_qa_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  voice_business_profile_id INTEGER NOT NULL REFERENCES voice_business_profiles(id) ON DELETE CASCADE,
  requested_engine TEXT NOT NULL CHECK (requested_engine IN ('openai','rules')),
  model TEXT,
  prompt_version TEXT NOT NULL,
  passed_count INTEGER NOT NULL DEFAULT 0,
  total_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_voice_qa_runs_profile ON voice_qa_runs(voice_business_profile_id, created_at DESC);

CREATE TABLE IF NOT EXISTS voice_qa_cases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  qa_run_id INTEGER NOT NULL REFERENCES voice_qa_runs(id) ON DELETE CASCADE,
  case_key TEXT NOT NULL,
  label TEXT NOT NULL,
  expected_classification TEXT NOT NULL,
  actual_classification TEXT NOT NULL,
  expected_outcome TEXT,
  actual_outcome TEXT,
  engine TEXT NOT NULL,
  passed INTEGER NOT NULL,
  reply TEXT NOT NULL,
  issues_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(qa_run_id, case_key)
);

CREATE TABLE IF NOT EXISTS voice_notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  voice_lead_id INTEGER REFERENCES voice_leads(id) ON DELETE CASCADE,
  voice_call_id INTEGER REFERENCES voice_calls(id) ON DELETE CASCADE,
  notification_type TEXT NOT NULL CHECK (notification_type IN ('new_lead','emergency','failed_transfer')),
  recipient TEXT NOT NULL,
  delivery_status TEXT NOT NULL DEFAULT 'pending' CHECK (delivery_status IN ('pending','sent','simulated','failed')),
  provider_message_id TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  sent_at TEXT,
  UNIQUE(voice_lead_id, notification_type)
);
CREATE INDEX IF NOT EXISTS idx_voice_notifications_status ON voice_notifications(delivery_status, created_at DESC);

CREATE TABLE IF NOT EXISTS voice_webhook_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT NOT NULL DEFAULT 'retell',
  event_type TEXT NOT NULL,
  provider_call_id TEXT,
  deduplication_key TEXT NOT NULL UNIQUE,
  payload_json TEXT NOT NULL,
  processing_status TEXT NOT NULL DEFAULT 'received' CHECK (processing_status IN ('received','processed','failed')),
  processing_attempts INTEGER NOT NULL DEFAULT 0,
  received_at TEXT NOT NULL DEFAULT (datetime('now')),
  processed_at TEXT,
  error_message TEXT
);
CREATE INDEX IF NOT EXISTS idx_voice_events_status ON voice_webhook_events(processing_status, received_at);
