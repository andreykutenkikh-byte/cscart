import dotenv from 'dotenv';
import { closeDb, query } from './db.js';
import { generateCachedImage, getImageCacheConfig } from './media.js';

dotenv.config();

function getArgValue(name, fallback) {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : fallback;
}

function parsePositiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback;
}

async function loadPrimaryImages(limit) {
  const result = await query(`
    SELECT DISTINCT ON (pi.product_id)
      pi.id::text AS id,
      pi.remote_url
    FROM product_images pi
    JOIN products p ON p.id = pi.product_id
    WHERE p.is_active = TRUE
    ORDER BY pi.product_id, pi.sort_order, pi.id
    LIMIT $1
  `, [limit]);
  return result.rows;
}

async function runWithConcurrency(items, concurrency, worker) {
  let index = 0;
  const workers = Array.from({ length: concurrency }, async () => {
    while (index < items.length) {
      const item = items[index];
      index += 1;
      await worker(item);
    }
  });
  await Promise.all(workers);
}

async function main() {
  const config = getImageCacheConfig();
  if (!config.enabled) {
    console.log('Image cache is disabled; prewarm skipped.');
    return;
  }

  const limit = parsePositiveInteger(getArgValue('limit', process.env.IMAGE_PREWARM_LIMIT), 200);
  const concurrency = parsePositiveInteger(getArgValue('concurrency', process.env.IMAGE_PREWARM_CONCURRENCY), 3);
  const variants = String(getArgValue('variants', 'list,thumb'))
    .split(',')
    .map((variant) => variant.trim())
    .filter(Boolean);

  const images = await loadPrimaryImages(limit);
  let generated = 0;
  let cached = 0;
  let failed = 0;

  await runWithConcurrency(images, concurrency, async (image) => {
    for (const variant of variants) {
      try {
        const result = await generateCachedImage(image, variant, config);
        if (result.fromCache) cached += 1;
        else generated += 1;
      } catch (error) {
        failed += 1;
        console.error(`Failed to prewarm image ${image.id} ${variant}: ${error.message}`);
      }
    }
  });

  console.log(JSON.stringify({
    images: images.length,
    variants,
    generated,
    cached,
    failed,
    cacheDir: config.cacheDir
  }));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDb();
  });

