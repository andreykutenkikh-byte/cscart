CREATE TABLE IF NOT EXISTS home_banners (
  id TEXT PRIMARY KEY,
  remote_url TEXT NOT NULL CONSTRAINT home_banners_remote_url_http CHECK (remote_url ~* '^https?://'),
  target_url TEXT,
  title TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_home_banners_sort_order ON home_banners(sort_order);
CREATE INDEX IF NOT EXISTS idx_home_banners_expires_at ON home_banners(expires_at);
