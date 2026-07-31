ALTER TABLE leads ADD COLUMN click_confirmation_enabled_at TEXT;

CREATE TABLE IF NOT EXISTS outreach_clicks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  channel TEXT NOT NULL CHECK (channel IN ('text', 'email')),
  classification TEXT NOT NULL CHECK (classification IN ('plausible', 'suspicious', 'bot')),
  confidence INTEGER NOT NULL DEFAULT 0,
  confirmation_required INTEGER NOT NULL DEFAULT 0,
  risk_reasons TEXT,
  country TEXT,
  region TEXT,
  region_code TEXT,
  city TEXT,
  timezone TEXT,
  asn INTEGER,
  as_organization TEXT,
  colo TEXT,
  ua_class TEXT,
  browser_headers_present INTEGER NOT NULL DEFAULT 0,
  bot_score INTEGER,
  verified_bot INTEGER,
  observed_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,
  confirmed_at TEXT,
  confirmation_signal TEXT,
  confirmation_origin TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_outreach_clicks_lead_observed
  ON outreach_clicks (lead_id, observed_at DESC);

CREATE INDEX IF NOT EXISTS idx_outreach_clicks_pending
  ON outreach_clicks (token, expires_at)
  WHERE confirmed_at IS NULL;
