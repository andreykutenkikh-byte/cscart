ALTER TABLE telegram_users ADD COLUMN IF NOT EXISTS language_code TEXT;

CREATE TABLE IF NOT EXISTS visitors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_user_id TEXT,
  username TEXT,
  first_name TEXT,
  last_name TEXT,
  language_code TEXT,
  source TEXT NOT NULL DEFAULT 'browser',
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  visits_count INTEGER NOT NULL DEFAULT 1,
  last_user_agent TEXT,
  last_ip_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_visitors_telegram_user_id_unique
  ON visitors(telegram_user_id)
  WHERE telegram_user_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_visitors_anonymous_source_ip_hash
  ON visitors(source, last_ip_hash)
  WHERE telegram_user_id IS NULL AND last_ip_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_visitors_telegram_user_id ON visitors(telegram_user_id);
CREATE INDEX IF NOT EXISTS idx_visitors_username ON visitors(username);
CREATE INDEX IF NOT EXISTS idx_visitors_last_seen_at ON visitors(last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_visitors_source ON visitors(source);
