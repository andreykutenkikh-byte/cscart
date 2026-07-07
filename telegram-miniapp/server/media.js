import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { query } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, '..');
const DEFAULT_CACHE_DIR = path.join(appRoot, '.cache', 'images');
const DEFAULT_ALLOWED_HOSTS = ['dvkeramik.ru', 'www.dvkeramik.ru'];
const VARIANT_ENV = {
  thumb: 'IMAGE_CACHE_THUMB_WIDTH',
  list: 'IMAGE_CACHE_LIST_WIDTH',
  detail: 'IMAGE_CACHE_DETAIL_WIDTH',
  viewer: 'IMAGE_CACHE_VIEWER_WIDTH'
};
const DEFAULT_VARIANT_WIDTHS = {
  thumb: 160,
  list: 360,
  detail: 1200,
  viewer: 1800
};
const IMAGE_CONTENT_TYPE = 'image/webp';
const IMAGE_EXTENSION = 'webp';
const MAX_REDIRECTS = 3;

function parseBoolean(value, fallback = true) {
  if (value === undefined || value === null || value === '') return fallback;
  return !['0', 'false', 'no', 'off'].includes(String(value).trim().toLowerCase());
}

function parsePositiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback;
}

function normalizeAllowedHosts(value) {
  return String(value || '')
    .split(',')
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);
}

export function getImageCacheConfig() {
  return {
    enabled: parseBoolean(process.env.IMAGE_CACHE_ENABLED, true),
    cacheDir: process.env.IMAGE_CACHE_DIR || DEFAULT_CACHE_DIR,
    allowedHosts: normalizeAllowedHosts(process.env.IMAGE_CACHE_ALLOWED_HOSTS).length
      ? normalizeAllowedHosts(process.env.IMAGE_CACHE_ALLOWED_HOSTS)
      : DEFAULT_ALLOWED_HOSTS,
    maxSourceBytes: parsePositiveInteger(process.env.IMAGE_CACHE_MAX_SOURCE_BYTES, 15_000_000),
    fetchTimeoutMs: parsePositiveInteger(process.env.IMAGE_CACHE_FETCH_TIMEOUT_MS, 8000),
    quality: Math.min(100, Math.max(1, parsePositiveInteger(process.env.IMAGE_CACHE_QUALITY, 78))),
    variants: Object.fromEntries(
      Object.entries(DEFAULT_VARIANT_WIDTHS).map(([variant, width]) => [
        variant,
        { width: parsePositiveInteger(process.env[VARIANT_ENV[variant]], width) }
      ])
    )
  };
}

export function isImageCacheEnabled() {
  return getImageCacheConfig().enabled;
}

function hashValue(value, length = 24) {
  return crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, length);
}

function createHttpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function parseIPv4(address) {
  const parts = address.split('.').map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return null;
  }
  return parts;
}

function isPublicIPv4(address) {
  const parts = parseIPv4(address);
  if (!parts) return false;
  const [a, b, c] = parts;
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 192 && b === 0 && c === 0) return false;
  if (a === 192 && b === 0 && c === 2) return false;
  if (a === 198 && (b === 18 || b === 19)) return false;
  if (a === 198 && b === 51 && c === 100) return false;
  if (a === 203 && b === 0 && c === 113) return false;
  return true;
}

function isPublicIPv6(address) {
  const normalized = address.toLowerCase();
  if (normalized === '::' || normalized === '::1') return false;
  if (normalized.startsWith('::ffff:')) {
    return isPublicIPv4(normalized.slice('::ffff:'.length));
  }
  if (/^f[cd]/.test(normalized)) return false;
  if (/^fe[89ab]/.test(normalized)) return false;
  if (normalized.startsWith('ff')) return false;
  if (normalized.startsWith('2001:db8')) return false;
  return true;
}

function isPublicIp(address) {
  const version = net.isIP(address);
  if (version === 4) return isPublicIPv4(address);
  if (version === 6) return isPublicIPv6(address);
  return false;
}

function validateSourceUrl(remoteUrl, config) {
  let parsed;
  try {
    parsed = new URL(remoteUrl);
  } catch {
    throw createHttpError(404, 'Image URL is invalid');
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw createHttpError(404, 'Image URL protocol is not allowed');
  }
  if (parsed.username || parsed.password) {
    throw createHttpError(404, 'Image URL credentials are not allowed');
  }
  if (!config.allowedHosts.includes(parsed.hostname.toLowerCase())) {
    throw createHttpError(404, 'Image host is not allowed');
  }
  if (net.isIP(parsed.hostname) && !isPublicIp(parsed.hostname)) {
    throw createHttpError(404, 'Image host IP is not allowed');
  }

  return parsed;
}

async function resolvePublicHost(hostname) {
  if (net.isIP(hostname)) {
    if (!isPublicIp(hostname)) throw createHttpError(404, 'Resolved image IP is not allowed');
    return { address: hostname, family: net.isIP(hostname) };
  }

  let records;
  try {
    records = await dns.lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw createHttpError(502, 'Image host could not be resolved');
  }

  if (!records.length || records.some((record) => !isPublicIp(record.address))) {
    throw createHttpError(502, 'Image host resolved to a non-public address');
  }
  return records[0];
}

async function downloadRemoteImage(remoteUrl, config, redirects = 0) {
  const parsed = validateSourceUrl(remoteUrl, config);
  const resolved = await resolvePublicHost(parsed.hostname);
  const client = parsed.protocol === 'https:' ? https : http;

  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };

    const request = client.get(parsed, {
      timeout: config.fetchTimeoutMs,
      headers: {
        accept: 'image/*,*/*;q=0.5',
        'user-agent': 'DVKeramikMiniAppImageCache/1.0'
      },
      lookup: (_hostname, options, callback) => {
        const lookupOptions = typeof options === 'object' ? options : {};
        const done = typeof options === 'function' ? options : callback;
        if (lookupOptions.all) {
          done(null, [{ address: resolved.address, family: resolved.family }]);
          return;
        }
        done(null, resolved.address, resolved.family);
      }
    }, (response) => {
      const remoteAddress = response.socket?.remoteAddress;
      if (remoteAddress && !isPublicIp(remoteAddress)) {
        response.resume();
        fail(createHttpError(502, 'Image upstream connected to a non-public address'));
        return;
      }

      if ([301, 302, 303, 307, 308].includes(response.statusCode || 0)) {
        const location = response.headers.location;
        response.resume();
        if (!location || redirects >= MAX_REDIRECTS) {
          fail(createHttpError(502, 'Image redirect limit exceeded'));
          return;
        }
        downloadRemoteImage(new URL(location, parsed).toString(), config, redirects + 1).then(resolve).catch(fail);
        return;
      }

      if (response.statusCode !== 200) {
        response.resume();
        fail(createHttpError(response.statusCode === 404 ? 404 : 502, `Image upstream returned HTTP ${response.statusCode}`));
        return;
      }

      const contentType = String(response.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
      if (!contentType.startsWith('image/')) {
        response.resume();
        fail(createHttpError(415, 'Image upstream returned a non-image content type'));
        return;
      }

      const chunks = [];
      let totalBytes = 0;
      response.on('data', (chunk) => {
        totalBytes += chunk.length;
        if (totalBytes > config.maxSourceBytes) {
          request.destroy(createHttpError(413, 'Image source is too large'));
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => {
        if (settled) return;
        settled = true;
        resolve(Buffer.concat(chunks));
      });
    });

    request.on('timeout', () => {
      request.destroy(createHttpError(504, 'Image upstream request timed out'));
    });
    request.on('error', fail);
  });
}

function getVariantConfig(variant, config) {
  const variantConfig = config.variants[variant];
  if (!variantConfig) throw createHttpError(404, 'Unknown image variant');
  return variantConfig;
}

export function buildImageVariantUrls(image, config = getImageCacheConfig()) {
  const remoteUrl = image?.remote_url || image?.remoteUrl || '';
  if (!image?.id || !remoteUrl) {
    return { remoteUrl: remoteUrl || null };
  }

  if (!config.enabled) {
    return {
      remoteUrl,
      thumbUrl: remoteUrl,
      listUrl: remoteUrl,
      detailUrl: remoteUrl,
      viewerUrl: remoteUrl
    };
  }

  const version = hashValue(remoteUrl, 12);
  const base = `/api/media/image/${encodeURIComponent(image.id)}`;
  return {
    remoteUrl,
    thumbUrl: `${base}/thumb?v=${version}`,
    listUrl: `${base}/list?v=${version}`,
    detailUrl: `${base}/detail?v=${version}`,
    viewerUrl: `${base}/viewer?v=${version}`
  };
}

function getCachePath(image, variant, config) {
  const variantConfig = getVariantConfig(variant, config);
  const remoteHash = hashValue(image.remote_url, 24);
  const optionsHash = hashValue(`${variant}:${variantConfig.width}:${config.quality}:webp`, 12);
  const safeImageId = String(image.id).replace(/[^a-zA-Z0-9_-]/g, '');
  const filename = `${safeImageId}-${remoteHash}-${optionsHash}.${IMAGE_EXTENSION}`;
  return path.join(config.cacheDir, variant, filename);
}

async function fileExists(filePath) {
  try {
    const stat = await fs.stat(filePath);
    return stat.isFile();
  } catch {
    return false;
  }
}

async function optimizeImage(buffer, variant, config) {
  const variantConfig = getVariantConfig(variant, config);
  const output = await sharp(buffer, { animated: false, limitInputPixels: 80_000_000 })
    .rotate()
    .resize({
      width: variantConfig.width,
      fit: 'inside',
      withoutEnlargement: true
    })
    .webp({ quality: config.quality, effort: 4 })
    .toBuffer();
  const metadata = await sharp(output).metadata();
  if (metadata.format !== 'webp' || !metadata.width || !metadata.height) {
    throw createHttpError(415, 'Image processing did not produce a valid WebP image');
  }
  return output;
}

export async function generateCachedImage(image, variant, config = getImageCacheConfig()) {
  if (!config.enabled) {
    throw createHttpError(404, 'Image cache is disabled');
  }
  validateSourceUrl(image.remote_url, config);

  const cachePath = getCachePath(image, variant, config);
  if (await fileExists(cachePath)) {
    return { cachePath, fromCache: true };
  }

  await fs.mkdir(path.dirname(cachePath), { recursive: true });
  const sourceBuffer = await downloadRemoteImage(image.remote_url, config);
  const outputBuffer = await optimizeImage(sourceBuffer, variant, config);
  const tempPath = `${cachePath}.${process.pid}.${Date.now()}.tmp`;

  try {
    await fs.writeFile(tempPath, outputBuffer, { flag: 'wx' });
    await fs.rename(tempPath, cachePath);
  } catch (error) {
    await fs.rm(tempPath, { force: true }).catch(() => {});
    if (!(await fileExists(cachePath))) throw error;
  }

  return { cachePath, fromCache: false };
}

async function getImageById(imageId) {
  const result = await query(`
    SELECT id::text AS id, remote_url
    FROM product_images
    WHERE id::text = $1
    LIMIT 1
  `, [String(imageId)]);
  return result.rows[0] || null;
}

async function sendCachedFile(req, res, cachePath) {
  const stat = await fs.stat(cachePath);
  const etag = `"${hashValue(`${cachePath}:${stat.size}:${stat.mtimeMs}`, 32)}"`;
  res.set({
    'Content-Type': IMAGE_CONTENT_TYPE,
    'Content-Length': String(stat.size),
    'Cache-Control': 'public, max-age=31536000, immutable',
    ETag: etag
  });

  if (req.headers['if-none-match'] === etag) {
    res.status(304).end();
    return;
  }
  createReadStream(cachePath).pipe(res);
}

export async function serveCachedImage(req, res) {
  const config = getImageCacheConfig();
  if (!config.enabled) {
    res.status(404).json({ error: 'Image cache is disabled' });
    return;
  }

  const variant = String(req.params.variant || '');
  getVariantConfig(variant, config);

  const image = await getImageById(req.params.imageId);
  if (!image) {
    res.status(404).json({ error: 'Image not found' });
    return;
  }

  try {
    const { cachePath } = await generateCachedImage(image, variant, config);
    await sendCachedFile(req, res, cachePath);
  } catch (error) {
    if ((error.statusCode || 500) >= 500) {
      console.error('Image cache error', {
        imageId: image.id,
        variant,
        message: error.message
      });
    }
    res.status(error.statusCode || 502).json({ error: error.message || 'Image could not be served' });
  }
}
