import crypto from 'node:crypto';

export function parseInitData(initData) {
  const params = new URLSearchParams(initData || '');
  const userRaw = params.get('user');
  if (!userRaw) return null;

  try {
    const user = JSON.parse(userRaw);
    return {
      telegramUserId: String(user.id),
      username: user.username || null,
      firstName: user.first_name || null,
      lastName: user.last_name || null,
      languageCode: user.language_code || null,
      source: 'telegram'
    };
  } catch {
    return null;
  }
}

export function verifyInitData(initData, botToken) {
  if (!initData || !botToken) return false;
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return false;
  params.delete('hash');

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const calculated = crypto.createHmac('sha256', secret).update(dataCheckString).digest('hex');
  const calculatedBuffer = Buffer.from(calculated, 'hex');
  const hashBuffer = Buffer.from(hash, 'hex');
  if (calculatedBuffer.length !== hashBuffer.length) {
    return false;
  }
  return crypto.timingSafeEqual(calculatedBuffer, hashBuffer);
}

export function getTelegramIdentity(req, { allowDev = true, requireVerified = false } = {}) {
  const initData = req.get('x-telegram-init-data') || req.body?.telegramInitData || '';
  if (initData) {
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const isVerified = botToken ? verifyInitData(initData, botToken) : false;
    if ((botToken || requireVerified) && !isVerified) {
      const error = new Error('Invalid Telegram initData');
      error.statusCode = 401;
      throw error;
    }
    const identity = parseInitData(initData);
    return identity ? { ...identity, isVerified } : null;
  }

  const devUserId = req.get('x-dev-telegram-user-id');
  if (allowDev && devUserId) {
    return {
      telegramUserId: `dev:${devUserId}`,
      username: 'dev_browser',
      firstName: 'Browser',
      lastName: 'Dev',
      languageCode: null,
      source: 'browser',
      isVerified: false
    };
  }

  return null;
}

function formatMoney(value) {
  if (value === null || value === undefined) return 'not specified';
  return `${Number(value).toLocaleString('ru-RU')} RUB`;
}

export async function notifyTelegramManager(order, items, identity = null) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_ADMIN_CHAT_ID;
  if (!token || !chatId) {
    return { skipped: true };
  }

  const adminUrl = process.env.MINIAPP_PUBLIC_URL
    ? `${process.env.MINIAPP_PUBLIC_URL.replace(/\/$/, '')}/admin/orders`
    : '';
  const lines = [
    'New DV Keramik request',
    '',
    'Customer:',
    `- Name: ${order.customer_name}`,
    `- Phone: ${order.phone}`,
    `- Telegram: ${identity?.username ? `@${identity.username}` : 'not provided'}`,
    `- Telegram ID: ${identity?.telegramUserId || 'not provided'}`,
    `- Delivery method: ${order.delivery_method}`,
    `- Comment: ${order.comment || 'none'}`,
    '',
    'Order:',
    `- Order ID: ${order.id}`,
    `- Total preliminary price: ${formatMoney(order.total_price)}`,
    `- Created at: ${new Date(order.created_at).toISOString()}`,
    '',
    'Items:',
    ...items.flatMap((item) => [
      `- ${item.product_name_snapshot}`,
      `  SKU / offer id: ${item.sku || item.product_external_id}`,
      `  Quantity: ${item.quantity}`,
      `  Price snapshot: ${formatMoney(item.price_snapshot)}`,
      item.product_url ? `  Product URL: ${item.product_url}` : ''
    ]),
    adminUrl ? '' : '',
    adminUrl ? `Admin orders: ${adminUrl}` : ''
  ].filter(Boolean);

  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: lines.join('\n'),
      disable_web_page_preview: true
    })
  });

  if (!response.ok) {
    throw new Error(`Telegram notification failed with HTTP ${response.status}`);
  }
  return { skipped: false };
}
