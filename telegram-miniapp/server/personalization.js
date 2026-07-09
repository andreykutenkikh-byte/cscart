import { query } from './db.js';
import { summarizeProduct } from './catalog.js';
import { getTelegramIdentity } from './telegram.js';

const FAVORITES_LIMIT = 100;
const VIEWED_PRODUCTS_LIMIT = 50;

function rejectUnauthorized() {
  const error = new Error('Telegram user is required');
  error.statusCode = 401;
  throw error;
}

function normalizeProductId(value) {
  return String(value || '').trim();
}

async function upsertTelegramUser(identity) {
  const result = await query(`
    INSERT INTO telegram_users (telegram_user_id, username, first_name, last_name, language_code, updated_at)
    VALUES ($1, $2, $3, $4, $5, now())
    ON CONFLICT (telegram_user_id) DO UPDATE SET
      username = EXCLUDED.username,
      first_name = EXCLUDED.first_name,
      last_name = EXCLUDED.last_name,
      language_code = EXCLUDED.language_code,
      updated_at = now()
    RETURNING id
  `, [
    identity.telegramUserId,
    identity.username,
    identity.firstName,
    identity.lastName,
    identity.languageCode
  ]);
  return result.rows[0].id;
}

async function getRequiredTelegramUser(req) {
  const identity = getTelegramIdentity(req, { allowDev: false, requireVerified: false });
  if (!identity?.telegramUserId || identity.source !== 'telegram') {
    rejectUnauthorized();
  }

  return {
    identity,
    telegramUserPk: await upsertTelegramUser(identity)
  };
}

async function getActiveProduct(productId) {
  const id = normalizeProductId(productId);
  if (!id) {
    const error = new Error('Product id is required');
    error.statusCode = 400;
    throw error;
  }

  const result = await query(`
    SELECT id, external_id, sku
    FROM products
    WHERE is_active = TRUE
      AND (id::text = $1 OR external_id = $1 OR sku = $1 OR slug = $1)
    LIMIT 1
  `, [id]);

  if (!result.rows[0]) {
    const error = new Error('Product not found');
    error.statusCode = 404;
    throw error;
  }

  return result.rows[0];
}

function productRowsQuery(tableName, timestampColumn, limit, includeViewedCount = false) {
  return `
    SELECT relation.${timestampColumn} AS relation_timestamp,
      ${includeViewedCount ? 'relation.viewed_count' : 'NULL::integer'} AS viewed_count,
      p.*,
      primary_image.id::text AS image_id,
      primary_image.remote_url AS image_remote_url
    FROM ${tableName} relation
    JOIN products p ON p.id = relation.product_id
    LEFT JOIN LATERAL (
      SELECT pi.id, pi.remote_url
      FROM product_images pi
      WHERE pi.product_id = p.id
      ORDER BY pi.sort_order, pi.id
      LIMIT 1
    ) primary_image ON TRUE
    WHERE relation.telegram_user_id = $1
      AND p.is_active = TRUE
    ORDER BY relation.${timestampColumn} DESC
    LIMIT ${limit}
  `;
}

function productRowByProductQuery(tableName, timestampColumn, includeViewedCount = false) {
  return `
    SELECT relation.${timestampColumn} AS relation_timestamp,
      ${includeViewedCount ? 'relation.viewed_count' : 'NULL::integer'} AS viewed_count,
      p.*,
      primary_image.id::text AS image_id,
      primary_image.remote_url AS image_remote_url
    FROM ${tableName} relation
    JOIN products p ON p.id = relation.product_id
    LEFT JOIN LATERAL (
      SELECT pi.id, pi.remote_url
      FROM product_images pi
      WHERE pi.product_id = p.id
      ORDER BY pi.sort_order, pi.id
      LIMIT 1
    ) primary_image ON TRUE
    WHERE relation.telegram_user_id = $1
      AND relation.product_id = $2
      AND p.is_active = TRUE
    LIMIT 1
  `;
}

function mapFavoriteRow(row) {
  return {
    ...summarizeProduct(row),
    isFavorite: true,
    favoriteCreatedAt: row.relation_timestamp
  };
}

function mapViewedRow(row) {
  return {
    ...summarizeProduct(row),
    viewedCount: Number(row.viewed_count || 0),
    lastViewedAt: row.relation_timestamp
  };
}

export async function getFavoriteProducts(req) {
  const { telegramUserPk } = await getRequiredTelegramUser(req);
  const result = await query(productRowsQuery('favorite_products', 'created_at', FAVORITES_LIMIT), [telegramUserPk]);
  return result.rows.map(mapFavoriteRow);
}

export async function addFavoriteProduct(req, productId) {
  const { telegramUserPk } = await getRequiredTelegramUser(req);
  const product = await getActiveProduct(productId);

  await query(`
    INSERT INTO favorite_products (telegram_user_id, product_id, product_external_id, sku)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (telegram_user_id, product_id) DO UPDATE SET
      product_external_id = EXCLUDED.product_external_id,
      sku = EXCLUDED.sku
  `, [telegramUserPk, product.id, product.external_id, product.sku]);

  const result = await query(productRowByProductQuery('favorite_products', 'created_at'), [telegramUserPk, product.id]);
  return result.rows[0] ? mapFavoriteRow(result.rows[0]) : null;
}

export async function removeFavoriteProduct(req, productId) {
  const { telegramUserPk } = await getRequiredTelegramUser(req);
  const product = await getActiveProduct(productId);
  await query(`
    DELETE FROM favorite_products
    WHERE telegram_user_id = $1
      AND product_id = $2
  `, [telegramUserPk, product.id]);
  return { removed: true, productId: product.id };
}

export async function getViewedProducts(req) {
  const { telegramUserPk } = await getRequiredTelegramUser(req);
  const result = await query(productRowsQuery('viewed_products', 'last_viewed_at', VIEWED_PRODUCTS_LIMIT, true), [telegramUserPk]);
  return result.rows.map(mapViewedRow);
}

export async function recordViewedProduct(req, productId) {
  const { telegramUserPk } = await getRequiredTelegramUser(req);
  const product = await getActiveProduct(productId);

  await query(`
    INSERT INTO viewed_products (telegram_user_id, product_id, product_external_id, sku)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (telegram_user_id, product_id) DO UPDATE SET
      product_external_id = EXCLUDED.product_external_id,
      sku = EXCLUDED.sku,
      viewed_count = viewed_products.viewed_count + 1,
      last_viewed_at = now()
  `, [telegramUserPk, product.id, product.external_id, product.sku]);

  const result = await query(productRowByProductQuery('viewed_products', 'last_viewed_at', true), [telegramUserPk, product.id]);
  return result.rows[0] ? mapViewedRow(result.rows[0]) : null;
}

export async function clearViewedProducts(req) {
  const { telegramUserPk } = await getRequiredTelegramUser(req);
  await query('DELETE FROM viewed_products WHERE telegram_user_id = $1', [telegramUserPk]);
  return { cleared: true };
}
