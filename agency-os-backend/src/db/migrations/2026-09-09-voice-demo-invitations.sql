CREATE TABLE IF NOT EXISTS voice_demo_invitations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  voice_business_profile_id INTEGER NOT NULL REFERENCES voice_business_profiles(id) ON DELETE CASCADE,
  prospect_id INTEGER REFERENCES leads(id) ON DELETE SET NULL,
  access_code TEXT NOT NULL UNIQUE,
  recipient_email TEXT NOT NULL,
  demo_phone_number TEXT NOT NULL,
  profile_snapshot_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','expired','revoked')),
  expires_at TEXT NOT NULL,
  sent_at TEXT,
  use_count INTEGER NOT NULL DEFAULT 0,
  last_used_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_voice_demo_invitation_code ON voice_demo_invitations(access_code, status, expires_at);
CREATE INDEX IF NOT EXISTS idx_voice_demo_invitation_profile ON voice_demo_invitations(voice_business_profile_id, created_at DESC);

CREATE TABLE IF NOT EXISTS voice_demo_invitation_uses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invitation_id INTEGER NOT NULL REFERENCES voice_demo_invitations(id) ON DELETE CASCADE,
  retell_call_id TEXT NOT NULL,
  caller_phone TEXT,
  used_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(invitation_id, retell_call_id)
);
CREATE INDEX IF NOT EXISTS idx_voice_demo_invitation_call ON voice_demo_invitation_uses(retell_call_id);
