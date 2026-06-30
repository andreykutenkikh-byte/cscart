DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'product_images'
      AND column_name = 'url'
  ) AND NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'product_images'
      AND column_name = 'remote_url'
  ) THEN
    ALTER TABLE product_images RENAME COLUMN url TO remote_url;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_products_sku ON products(sku);

ALTER TABLE products ADD COLUMN IF NOT EXISTS description TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'product_images_remote_url_http'
  ) THEN
    ALTER TABLE product_images
      ADD CONSTRAINT product_images_remote_url_http CHECK (remote_url ~* '^https?://');
  END IF;
END $$;
