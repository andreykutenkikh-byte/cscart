CREATE TABLE IF NOT EXISTS favorite_products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_user_id UUID NOT NULL REFERENCES telegram_users(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  product_external_id TEXT NOT NULL,
  sku TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (telegram_user_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_favorite_products_user_created_at
  ON favorite_products(telegram_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_favorite_products_product_id
  ON favorite_products(product_id);

CREATE TABLE IF NOT EXISTS viewed_products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_user_id UUID NOT NULL REFERENCES telegram_users(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  product_external_id TEXT NOT NULL,
  sku TEXT,
  viewed_count INTEGER NOT NULL DEFAULT 1 CHECK (viewed_count > 0),
  first_viewed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_viewed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (telegram_user_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_viewed_products_user_last_viewed_at
  ON viewed_products(telegram_user_id, last_viewed_at DESC);

CREATE INDEX IF NOT EXISTS idx_viewed_products_product_id
  ON viewed_products(product_id);
