import crypto from 'node:crypto';
import https from 'node:https';
import { query, withTransaction } from './db.js';
import { generateCachedImage, sendCachedFile } from './media.js';

const DEFAULT_HOME_URL = 'https://dvkeramik.ru/';
const DEFAULT_CACHE_TTL_HOURS = 24;
const MAX_HOME_HTML_BYTES = 1_500_000;
const ALLOWED_HOSTS = new Set(['dvkeramik.ru', 'www.dvkeramik.ru']);

function parsePositiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function getHomeUrl() {
  return process.env.DVKERAMIK_HOME_URL || DEFAULT_HOME_URL;
}

function getCacheTtlHours() {
  return parsePositiveNumber(process.env.HOME_BANNERS_CACHE_TTL_HOURS, DEFAULT_CACHE_TTL_HOURS);
}

function hashValue(value, length = 24) {
  return crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, length);
}

function decodeHtml(value) {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function stripTags(value) {
  return decodeHtml(String(value || '').replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim();
}

function normalizeSourceUrl(value, baseUrl) {
  try {
    const url = new URL(decodeHtml(value), baseUrl);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    if (!ALLOWED_HOSTS.has(url.hostname.toLowerCase())) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function normalizeTargetUrl(value, baseUrl) {
  if (!value) return null;
  try {
    const url = new URL(decodeHtml(value), baseUrl);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    if (!ALLOWED_HOSTS.has(url.hostname.toLowerCase())) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function fetchText(url) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || !ALLOWED_HOSTS.has(parsed.hostname.toLowerCase())) {
    throw new Error('Home banner source URL is not allowed');
  }

  return new Promise((resolve, reject) => {
    const request = https.get(parsed, {
      timeout: 12000,
      headers: {
        accept: 'text/html,*/*;q=0.8',
        'user-agent': 'DVKeramikMiniAppBannerCache/1.0'
      }
    }, (response) => {
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`Home page returned HTTP ${response.statusCode}`));
        return;
      }

      const chunks = [];
      let totalBytes = 0;
      response.on('data', (chunk) => {
        totalBytes += chunk.length;
        if (totalBytes > MAX_HOME_HTML_BYTES) {
          request.destroy(new Error('Home page response is too large'));
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    });

    request.on('timeout', () => request.destroy(new Error('Home page request timed out')));
    request.on('error', reject);
  });
}

export function parseHomeBanners(html, baseUrl = DEFAULT_HOME_URL) {
  const sliderStart = html.indexOf('id="banner_slider_22342"');
  if (sliderStart === -1) return [];

  const sliderEnd = html.indexOf('<!-- Inline script moved to the bottom of the page -->', sliderStart);
  const segment = html.slice(sliderStart, sliderEnd === -1 ? undefined : sliderEnd);
  const parts = segment.split(/(?=<div class="abyt_banner\b)/).slice(1);
  const banners = [];
  const seen = new Set();

  for (const part of parts) {
    const remoteUrl = normalizeSourceUrl(part.match(/data-background-url="([^"]+)"/i)?.[1], baseUrl)
      || normalizeSourceUrl(part.match(/data-src="([^"]+)"/i)?.[1], baseUrl);
    if (!remoteUrl || !remoteUrl.includes('/images/abt__yt_banners/') || seen.has(remoteUrl)) {
      continue;
    }

    seen.add(remoteUrl);
    const targetUrl = normalizeTargetUrl(part.match(/<a\b[^>]*href="([^"]+)"/i)?.[1], baseUrl);
    const rawTitle = stripTags(part.match(/<div class="abyt-a-title[^"]*"[^>]*>([\s\S]*?)<\/div>/i)?.[1]);
    const title = rawTitle && rawTitle !== '.' ? rawTitle : '';

    banners.push({
      id: hashValue(`${remoteUrl}|${targetUrl || ''}`, 20),
      remoteUrl,
      targetUrl,
      title,
      sortOrder: banners.length
    });
  }

  return banners.slice(0, 10);
}

function mapBannerRow(row) {
  const version = hashValue(`${row.remote_url}:${row.fetched_at}`, 12);
  return {
    id: row.id,
    remoteUrl: row.remote_url,
    imageUrl: `/api/media/banner/${encodeURIComponent(row.id)}/banner?v=${version}`,
    targetUrl: row.target_url || null,
    title: row.title || '',
    sortOrder: row.sort_order,
    fetchedAt: row.fetched_at,
    expiresAt: row.expires_at
  };
}

async function readBannerRows({ validOnly = false } = {}) {
  const result = await query(`
    SELECT id, remote_url, target_url, title, sort_order, fetched_at, expires_at
    FROM home_banners
    ${validOnly ? 'WHERE expires_at > now()' : ''}
    ORDER BY sort_order ASC
  `);
  return result.rows;
}

async function replaceBannerCache(banners) {
  const ttlHours = getCacheTtlHours();
  const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000);

  await withTransaction(async (client) => {
    await client.query('DELETE FROM home_banners');
    for (const banner of banners) {
      await client.query(`
        INSERT INTO home_banners (id, remote_url, target_url, title, sort_order, fetched_at, expires_at)
        VALUES ($1, $2, $3, $4, $5, now(), $6)
      `, [banner.id, banner.remoteUrl, banner.targetUrl, banner.title, banner.sortOrder, expiresAt]);
    }
  });
}

export async function refreshHomeBanners() {
  const homeUrl = getHomeUrl();
  const html = await fetchText(homeUrl);
  const banners = parseHomeBanners(html, homeUrl);
  if (!banners.length) {
    throw new Error('Home page banners were not found');
  }
  await replaceBannerCache(banners);
  return (await readBannerRows()).map(mapBannerRow);
}

export async function getHomeBanners() {
  const validRows = await readBannerRows({ validOnly: true });
  if (validRows.length) {
    return validRows.map(mapBannerRow);
  }

  const staleRows = await readBannerRows();
  try {
    return await refreshHomeBanners();
  } catch (error) {
    if (staleRows.length) {
      console.warn('Using stale home banner cache', error.message);
      return staleRows.map(mapBannerRow);
    }
    console.warn('Home banner cache is empty', error.message);
    return [];
  }
}

async function getBannerById(id) {
  const result = await query(`
    SELECT id, remote_url, fetched_at
    FROM home_banners
    WHERE id = $1
    LIMIT 1
  `, [String(id)]);
  return result.rows[0] || null;
}

export async function serveCachedBannerImage(req, res) {
  const banner = await getBannerById(req.params.bannerId);
  if (!banner) {
    res.status(404).json({ error: 'Banner image not found' });
    return;
  }

  try {
    const cacheVersion = hashValue(banner.fetched_at || '', 8);
    const { cachePath } = await generateCachedImage({
      id: `${banner.id}-${cacheVersion}`,
      remote_url: banner.remote_url
    }, req.params.variant || 'banner');
    await sendCachedFile(req, res, cachePath);
  } catch (error) {
    if ((error.statusCode || 500) >= 500) {
      console.error('Banner image cache error', {
        bannerId: banner.id,
        message: error.message
      });
    }
    res.status(error.statusCode || 502).json({ error: error.message || 'Banner image could not be served' });
  }
}
