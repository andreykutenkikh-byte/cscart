import crypto from 'node:crypto';

function parseInitData(initData) {
  const params = new URLSearchParams(initData || '');
  const userRaw = params.get('user');
  if (!userRaw) return null;
  try {
    const user = JSON.parse(userRaw);
    return {
      telegramUserId: String(user.id),
      username: user.username || null,
      firstName: user.first_name || null,
      lastName: user.last_name || null
    };
  } catch {
    return null;
  }
}

function verifyInitData(initData, botToken) {
  if (!initData || !botToken) return true;
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

export function getTelegramIdentity(req) {
  const initData = req.get('x-telegram-init-data') || req.body?.telegramInitData || '';
  if (initData) {
    if (!verifyInitData(initData, process.env.TELEGRAM_BOT_TOKEN)) {
      const error = new Error('Invalid Telegram initData');
      error.statusCode = 401;
      throw error;
    }
    return parseInitData(initData);
  }

  const devUserId = req.get('x-dev-telegram-user-id');
  if (devUserId) {
    return {
      telegramUserId: `dev:${devUserId}`,
      username: 'dev_browser',
      firstName: 'Browser',
      lastName: 'Dev'
    };
  }

  return null;
}

export async function notifyTelegramManager(order, items) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_ADMIN_CHAT_ID;
  if (!token || !chatId) {
    return { skipped: true };
  }

  const lines = [
    `Новая заявка DV Keramik #${order.id.slice(0, 8)}`,
    `Имя: ${order.customer_name}`,
    `Телефон: ${order.phone}`,
    `Способ: ${order.delivery_method}`,
    order.comment ? `Комментарий: ${order.comment}` : '',
    '',
    'Товары:',
    ...items.map((item) => `- ${item.product_name_snapshot} x${item.quantity} (${item.price_snapshot || 0})`),
    '',
    `Итого ориентировочно: ${order.total_price}`
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
