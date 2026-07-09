import { query } from './db.js';
import { getTelegramIdentity } from './telegram.js';
import { importDvKeramikFeed } from './importer.js';
import { getHomeBanners } from './banners.js';

const PAGE_LIMIT_MAX = 100;
const BRAND_SETTING_KEY = 'brand';
const BRAND_DEFAULTS = {
  title: 'ДВ Керамик',
  subtitle: 'каталог обновляется ежедневно',
  logoUrl: '',
  initials: 'ДК'
};

function splitEnvList(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeUsername(username) {
  return String(username || '').trim().replace(/^@+/, '').toLowerCase();
}

function getAdminUsernames() {
  return new Set(splitEnvList(process.env.ADMIN_TELEGRAM_USERNAMES).map(normalizeUsername));
}

function getAdminIds() {
  return new Set(splitEnvList(process.env.ADMIN_TELEGRAM_IDS).map(String));
}

function isDevAdminBypass(req) {
  return process.env.NODE_ENV !== 'production'
    && Boolean(process.env.DEV_ADMIN_BYPASS)
    && req.get('x-dev-admin-bypass') === process.env.DEV_ADMIN_BYPASS;
}

function isConfiguredAdmin(identity) {
  if (!identity?.isVerified) return false;
  const ids = getAdminIds();
  if (identity.telegramUserId && ids.has(String(identity.telegramUserId))) return true;

  const usernames = getAdminUsernames();
  const username = normalizeUsername(identity.username);
  return Boolean(username && usernames.has(username));
}

function publicUser(identity, isAdmin = false) {
  if (!identity) {
    return { user: null, isAdmin: false };
  }
  return {
    user: {
      telegramUserId: identity.telegramUserId || null,
      username: identity.username || null,
      firstName: identity.firstName || null,
      lastName: identity.lastName || null,
      languageCode: identity.languageCode || null,
      source: identity.source || 'browser'
    },
    isAdmin
  };
}

export function getMe(req) {
  if (isDevAdminBypass(req)) {
    return publicUser({
      telegramUserId: 'dev:admin',
      username: 'dev_admin',
      firstName: 'Dev',
      lastName: 'Admin',
      languageCode: null,
      source: 'browser',
      isVerified: true
    }, true);
  }

  const identity = getTelegramIdentity(req, { allowDev: true, requireVerified: false });
  return publicUser(identity, isConfiguredAdmin(identity));
}

export function requireAdmin(req) {
  if (isDevAdminBypass(req)) {
    return {
      telegramUserId: 'dev:admin',
      username: 'dev_admin',
      firstName: 'Dev',
      lastName: 'Admin',
      languageCode: null,
      source: 'browser',
      isVerified: true
    };
  }

  const identity = getTelegramIdentity(req, { allowDev: false, requireVerified: true });
  if (!identity) {
    const error = new Error('Нужна авторизация через Telegram');
    error.statusCode = 401;
    throw error;
  }
  if (!isConfiguredAdmin(identity)) {
    const error = new Error('Нет доступа администратора');
    error.statusCode = 403;
    throw error;
  }
  return identity;
}

function pagination(queryParams) {
  const page = Math.max(1, Number.parseInt(queryParams.page, 10) || 1);
  const limit = Math.min(PAGE_LIMIT_MAX, Math.max(1, Number.parseInt(queryParams.limit, 10) || 30));
  return { page, limit, offset: (page - 1) * limit };
}

function cleanText(value, fallback, maxLength) {
  const text = String(value || '').trim().replace(/\s+/g, ' ');
  return (text || fallback).slice(0, maxLength);
}

function cleanLogoUrl(value) {
  const url = String(value || '').trim();
  if (!url) return '';
  if (url.length > 2048) {
    const error = new Error('URL логотипа слишком длинный');
    error.statusCode = 400;
    throw error;
  }

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    const error = new Error('Укажите корректный URL логотипа');
    error.statusCode = 400;
    throw error;
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    const error = new Error('URL логотипа должен начинаться с http:// или https://');
    error.statusCode = 400;
    throw error;
  }

  return parsed.toString();
}

async function getSetting(key) {
  const result = await query('SELECT value FROM app_settings WHERE key = $1', [key]);
  return result.rows[0]?.value || null;
}

async function upsertSetting(key, value) {
  await query(`
    INSERT INTO app_settings (key, value, updated_at)
    VALUES ($1, $2::jsonb, now())
    ON CONFLICT (key) DO UPDATE
      SET value = EXCLUDED.value,
          updated_at = now()
  `, [key, JSON.stringify(value)]);
}

export async function getBrandSettings() {
  const saved = await getSetting(BRAND_SETTING_KEY);
  return {
    ...BRAND_DEFAULTS,
    ...(saved && typeof saved === 'object' ? saved : {})
  };
}

export async function getPublicAppSettings() {
  return {
    brand: await getBrandSettings(),
    homeBanners: await getHomeBanners()
  };
}

export async function updateAdminBrandSettings(input = {}) {
  const brand = {
    title: cleanText(input.title, BRAND_DEFAULTS.title, 80),
    subtitle: cleanText(input.subtitle, BRAND_DEFAULTS.subtitle, 120),
    logoUrl: cleanLogoUrl(input.logoUrl),
    initials: cleanText(input.initials, BRAND_DEFAULTS.initials, 6)
  };

  await upsertSetting(BRAND_SETTING_KEY, brand);
  return brand;
}

export async function getAdminSettings() {
  const latestImport = (await query(`
    SELECT status, started_at, finished_at, categories_total, offers_total,
      products_created, products_updated, products_hidden, error_message
    FROM import_runs
    ORDER BY started_at DESC
    LIMIT 1
  `)).rows[0] || null;

  const counts = (await query(`
    SELECT
      (SELECT count(*)::int FROM categories WHERE is_active = TRUE) AS active_categories,
      (SELECT count(*)::int FROM products WHERE is_active = TRUE) AS active_products,
      (SELECT count(*)::int FROM products WHERE is_active = FALSE) AS hidden_products,
      (SELECT count(*)::int FROM visitors) AS visitors_total,
      (SELECT count(*)::int FROM orders) AS orders_total
  `)).rows[0];

  return {
    feedUrl: process.env.DVKERAMIK_YML_URL || 'https://dvkeramik.ru/yml_get/26',
    miniappPublicUrl: process.env.MINIAPP_PUBLIC_URL || null,
    telegramNotificationsConfigured: Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_ADMIN_CHAT_ID),
    brand: await getBrandSettings(),
    latestImport,
    counts
  };
}

export async function runAdminImportNow() {
  return importDvKeramikFeed();
}

export async function getAdminVisitors(queryParams) {
  const { page, limit, offset } = pagination(queryParams);
  const total = Number((await query('SELECT count(*) AS count FROM visitors')).rows[0].count);
  const result = await query(`
    SELECT v.id, v.telegram_user_id, v.username, v.first_name, v.last_name,
      v.language_code, v.source, v.first_seen_at, v.last_seen_at, v.visits_count,
      COALESCE(count(o.id), 0)::int AS orders_count,
      max(o.created_at) AS last_order_at
    FROM visitors v
    LEFT JOIN telegram_users tu ON tu.telegram_user_id = v.telegram_user_id
    LEFT JOIN orders o ON o.telegram_user_id = tu.id
    GROUP BY v.id
    ORDER BY v.last_seen_at DESC
    LIMIT $1 OFFSET $2
  `, [limit, offset]);

  return {
    visitors: result.rows.map((visitor) => ({
      id: visitor.id,
      telegramUserId: visitor.telegram_user_id,
      username: visitor.username,
      firstName: visitor.first_name,
      lastName: visitor.last_name,
      languageCode: visitor.language_code,
      source: visitor.source,
      firstSeenAt: visitor.first_seen_at,
      lastSeenAt: visitor.last_seen_at,
      visitsCount: visitor.visits_count,
      ordersCount: visitor.orders_count,
      lastOrderAt: visitor.last_order_at
    })),
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
      hasNextPage: offset + limit < total
    }
  };
}

export async function getAdminOrders(queryParams) {
  const { page, limit, offset } = pagination(queryParams);
  const total = Number((await query('SELECT count(*) AS count FROM orders')).rows[0].count);
  const result = await query(`
    SELECT o.*,
      tu.telegram_user_id AS telegram_user_id_text,
      tu.username,
      tu.first_name,
      tu.last_name,
      COALESCE(
        json_agg(
          json_build_object(
            'productExternalId', oi.product_external_id,
            'sku', oi.sku,
            'productName', oi.product_name_snapshot,
            'price', oi.price_snapshot,
            'quantity', oi.quantity
          )
          ORDER BY oi.id
        ) FILTER (WHERE oi.id IS NOT NULL),
        '[]'
      ) AS items
    FROM orders o
    LEFT JOIN telegram_users tu ON tu.id = o.telegram_user_id
    LEFT JOIN order_items oi ON oi.order_id = o.id
    GROUP BY o.id, tu.telegram_user_id, tu.username, tu.first_name, tu.last_name
    ORDER BY o.created_at DESC
    LIMIT $1 OFFSET $2
  `, [limit, offset]);

  return {
    orders: result.rows.map((order) => ({
      id: order.id,
      status: order.status,
      customerName: order.customer_name,
      phone: order.phone,
      deliveryMethod: order.delivery_method,
      comment: order.comment,
      telegramUserId: order.telegram_user_id_text,
      username: order.username,
      firstName: order.first_name,
      lastName: order.last_name,
      createdAt: order.created_at,
      totalPrice: Number(order.total_price || 0),
      items: order.items
    })),
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
      hasNextPage: offset + limit < total
    }
  };
}
