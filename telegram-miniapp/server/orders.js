import { query, withTransaction } from './db.js';
import { getTelegramIdentity, notifyTelegramManager } from './telegram.js';

function normalizeItems(items) {
  if (!Array.isArray(items)) return [];
  return items
    .map((item) => ({
      productExternalId: String(item.productExternalId || item.externalId || item.sku || '').trim(),
      quantity: Math.max(1, Number.parseInt(item.quantity, 10) || 1)
    }))
    .filter((item) => item.productExternalId);
}

async function upsertTelegramUser(client, identity) {
  if (!identity?.telegramUserId) return null;
  const result = await client.query(`
    INSERT INTO telegram_users (telegram_user_id, username, first_name, last_name, updated_at)
    VALUES ($1, $2, $3, $4, now())
    ON CONFLICT (telegram_user_id) DO UPDATE SET
      username = EXCLUDED.username,
      first_name = EXCLUDED.first_name,
      last_name = EXCLUDED.last_name,
      updated_at = now()
    RETURNING id
  `, [identity.telegramUserId, identity.username, identity.firstName, identity.lastName]);
  return result.rows[0].id;
}

export async function createOrder(req) {
  const identity = getTelegramIdentity(req);
  const body = req.body || {};
  const customerName = String(body.customerName || body.name || '').trim();
  const phone = String(body.phone || '').trim();
  const deliveryMethod = String(body.deliveryMethod || 'pickup').trim();
  const comment = String(body.comment || '').trim();
  const requestedItems = normalizeItems(body.items);

  if (!customerName) {
    const error = new Error('Name is required');
    error.statusCode = 400;
    throw error;
  }
  if (!phone) {
    const error = new Error('Phone is required');
    error.statusCode = 400;
    throw error;
  }
  if (!requestedItems.length) {
    const error = new Error('Cart is empty');
    error.statusCode = 400;
    throw error;
  }

  const result = await withTransaction(async (client) => {
    const telegramUserPk = await upsertTelegramUser(client, identity);
    const ids = requestedItems.map((item) => item.productExternalId);
    const products = (await client.query(`
      SELECT *
      FROM products
      WHERE is_active = TRUE
        AND (external_id = ANY($1::text[]) OR sku = ANY($1::text[]))
    `, [ids])).rows;
    const productByExternalId = new Map();
    for (const product of products) {
      productByExternalId.set(product.external_id, product);
      productByExternalId.set(product.sku, product);
    }

    const orderItems = [];
    for (const requested of requestedItems) {
      const product = productByExternalId.get(requested.productExternalId);
      if (!product) continue;
      orderItems.push({
        product,
        quantity: requested.quantity,
        total: Number(product.price || 0) * requested.quantity
      });
    }

    if (!orderItems.length) {
      const error = new Error('No active products found in cart');
      error.statusCode = 400;
      throw error;
    }

    const totalPrice = orderItems.reduce((sum, item) => sum + item.total, 0);
    const orderResult = await client.query(`
      INSERT INTO orders (telegram_user_id, customer_name, phone, delivery_method, comment, total_price)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `, [telegramUserPk, customerName, phone, deliveryMethod, comment || null, totalPrice]);
    const order = orderResult.rows[0];

    const savedItems = [];
    for (const item of orderItems) {
      const saved = await client.query(`
        INSERT INTO order_items (
          order_id, product_id, product_external_id, sku, product_name_snapshot,
          price_snapshot, quantity, params_snapshot
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
        RETURNING *
      `, [
        order.id,
        item.product.id,
        item.product.external_id,
        item.product.sku,
        item.product.name,
        item.product.price,
        item.quantity,
        JSON.stringify(item.product.params_json || {})
      ]);
      savedItems.push(saved.rows[0]);
    }

    return { order, items: savedItems };
  });

  notifyTelegramManager(result.order, result.items).catch((error) => {
    console.error('Telegram manager notification failed:', error.message);
  });

  return result;
}

export async function getOrders(req) {
  const identity = getTelegramIdentity(req);
  if (!identity?.telegramUserId) return [];
  const result = await query(`
    SELECT o.*,
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
    JOIN telegram_users tu ON tu.id = o.telegram_user_id
    LEFT JOIN order_items oi ON oi.order_id = o.id
    WHERE tu.telegram_user_id = $1
    GROUP BY o.id
    ORDER BY o.created_at DESC
    LIMIT 20
  `, [identity.telegramUserId]);
  return result.rows.map((order) => ({
    id: order.id,
    status: order.status,
    totalPrice: Number(order.total_price || 0),
    createdAt: order.created_at,
    items: order.items
  }));
}
