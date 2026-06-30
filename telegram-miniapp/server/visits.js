import crypto from 'node:crypto';
import { query } from './db.js';
import { getTelegramIdentity } from './telegram.js';

function requestIp(req) {
  const forwarded = req.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return req.ip || req.socket?.remoteAddress || '';
}

function ipHash(req) {
  const ip = requestIp(req);
  if (!ip) return null;
  const secret = process.env.VISITOR_HASH_SECRET
    || process.env.IMPORT_SECRET
    || process.env.ADMIN_IMPORT_SECRET
    || process.env.DATABASE_URL
    || 'dvkeramik-miniapp';
  return crypto.createHash('sha256').update(`${secret}:${ip}`).digest('hex');
}

function sourceFrom(req, identity) {
  if (identity?.source === 'telegram') return 'telegram';
  return String(req.body?.source || req.get('x-miniapp-source') || 'browser').slice(0, 40);
}

export async function recordVisit(req) {
  const identity = getTelegramIdentity(req, { allowDev: true, requireVerified: false });
  const isTelegram = identity?.source === 'telegram' && identity.telegramUserId && !identity.telegramUserId.startsWith('dev:');
  const visitor = {
    telegramUserId: isTelegram ? identity.telegramUserId : null,
    username: isTelegram ? identity.username : null,
    firstName: isTelegram ? identity.firstName : null,
    lastName: isTelegram ? identity.lastName : null,
    languageCode: isTelegram ? identity.languageCode : null,
    source: sourceFrom(req, identity),
    userAgent: String(req.get('user-agent') || '').slice(0, 1000),
    ipHash: ipHash(req)
  };

  const result = visitor.telegramUserId
    ? await query(`
      INSERT INTO visitors (
        telegram_user_id, username, first_name, last_name, language_code,
        source, last_user_agent, last_ip_hash
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (telegram_user_id) WHERE telegram_user_id IS NOT NULL DO UPDATE SET
        username = EXCLUDED.username,
        first_name = EXCLUDED.first_name,
        last_name = EXCLUDED.last_name,
        language_code = EXCLUDED.language_code,
        source = EXCLUDED.source,
        last_seen_at = now(),
        visits_count = visitors.visits_count + 1,
        last_user_agent = EXCLUDED.last_user_agent,
        last_ip_hash = EXCLUDED.last_ip_hash,
        updated_at = now()
      RETURNING *
    `, [
      visitor.telegramUserId,
      visitor.username,
      visitor.firstName,
      visitor.lastName,
      visitor.languageCode,
      visitor.source,
      visitor.userAgent,
      visitor.ipHash
    ])
    : await query(`
      INSERT INTO visitors (source, last_user_agent, last_ip_hash)
      VALUES ($1, $2, $3)
      ON CONFLICT (source, last_ip_hash) WHERE telegram_user_id IS NULL AND last_ip_hash IS NOT NULL DO UPDATE SET
        last_seen_at = now(),
        visits_count = visitors.visits_count + 1,
        last_user_agent = EXCLUDED.last_user_agent,
        updated_at = now()
      RETURNING *
    `, [visitor.source, visitor.userAgent, visitor.ipHash]);

  const row = result.rows[0];
  return {
    id: row.id,
    source: row.source,
    telegramUserId: row.telegram_user_id,
    visitsCount: row.visits_count,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at
  };
}
