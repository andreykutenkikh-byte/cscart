import { XMLParser } from 'fast-xml-parser';
import slugify from 'slugify';

const DEFAULT_SOURCE_URL = 'https://dvkeramik.ru/yml_get/26';

function asArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function asText(value) {
  if (value === undefined || value === null) return '';
  if (typeof value === 'object') {
    return String(value['#text'] ?? value.text ?? '').trim();
  }
  return String(value).trim();
}

function makeSlug(value, fallback) {
  const slug = slugify(String(value || ''), { lower: true, strict: true, locale: 'ru' });
  return slug || slugify(String(fallback), { lower: true, strict: true }) || String(fallback);
}

function parsePrice(value) {
  const cleaned = String(value ?? '').replace(',', '.').replace(/[^\d.]/g, '');
  if (!cleaned) return null;
  const numeric = Number(cleaned);
  return Number.isFinite(numeric) ? numeric : null;
}

function normalizeRemoteImageUrl(value, sourceUrl) {
  const raw = asText(value);
  if (!raw) return '';

  try {
    const sourceOrigin = new URL(sourceUrl).origin;
    const remoteUrl = new URL(raw, `${sourceOrigin}/`);
    if (remoteUrl.protocol !== 'http:' && remoteUrl.protocol !== 'https:') {
      return '';
    }
    return remoteUrl.toString();
  } catch {
    return '';
  }
}

function normalizeParams(offer) {
  const params = {};

  for (const param of asArray(offer.param)) {
    const name = asText(param.name ?? param['@_name']);
    const value = asText(param);
    if (!name || !value) continue;
    if (params[name]) {
      params[name] = Array.isArray(params[name]) ? [...params[name], value] : [params[name], value];
    } else {
      params[name] = value;
    }
  }

  for (const key of ['vendor', 'model']) {
    const value = asText(offer[key]);
    if (value && !params[key]) {
      params[key] = value;
    }
  }

  return params;
}

function parseFeed(xml, { sourceUrl = DEFAULT_SOURCE_URL } = {}) {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '',
    textNodeName: '#text',
    trimValues: true,
    parseAttributeValue: false,
    parseTagValue: false
  });

  const doc = parser.parse(xml);
  const shop = doc?.yml_catalog?.shop;
  if (!shop) {
    throw new Error('Invalid YML feed: yml_catalog/shop not found');
  }

  const categories = asArray(shop.categories?.category).map((category) => ({
    externalId: asText(category.id),
    parentExternalId: asText(category.parentId) || null,
    name: asText(category),
    slug: makeSlug(asText(category), asText(category.id))
  })).filter((category) => category.externalId && category.name);

  const offers = asArray(shop.offers?.offer).map((offer) => {
    const externalId = asText(offer.id);
    const name = asText(offer.name) || asText(offer.model) || externalId;
    const vendorCode = asText(offer.vendorCode);
    const pictures = asArray(offer.picture)
      .map((picture) => normalizeRemoteImageUrl(picture, sourceUrl))
      .filter(Boolean);

    return {
      externalId,
      sku: vendorCode || externalId,
      categoryExternalId: asText(offer.categoryId) || null,
      name,
      description: asText(offer.description) || null,
      slug: makeSlug(name, externalId),
      productUrl: asText(offer.url) || null,
      price: parsePrice(offer.price),
      currencyId: asText(offer.currencyId) || null,
      available: ['true', '1', 'yes', 'y'].includes(asText(offer.available).toLowerCase()),
      params: normalizeParams(offer),
      pictures
    };
  }).filter((offer) => offer.externalId && offer.name);

  return { categories, offers };
}

async function fetchFeed(sourceUrl) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);
  try {
    const response = await fetch(sourceUrl, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`Feed request failed with HTTP ${response.status}`);
    }
    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
}

async function upsertCategories(client, categories) {
  if (!categories.length) return;
  await client.query(`
    INSERT INTO categories (external_id, parent_external_id, name, slug, is_active, updated_at)
    SELECT external_id, parent_external_id, name, slug, TRUE, now()
    FROM jsonb_to_recordset($1::jsonb) AS category(
      external_id TEXT,
      parent_external_id TEXT,
      name TEXT,
      slug TEXT
    )
    ON CONFLICT (external_id) DO UPDATE SET
      parent_external_id = EXCLUDED.parent_external_id,
      name = EXCLUDED.name,
      slug = EXCLUDED.slug,
      is_active = TRUE,
      updated_at = now()
  `, [JSON.stringify(categories.map((category) => ({
    external_id: category.externalId,
    parent_external_id: category.parentExternalId,
    name: category.name,
    slug: category.slug
  })))]);
}

async function upsertProducts(client, sourceUrl, offers) {
  if (!offers.length) return [];

  const productRows = offers.map((offer) => ({
    external_id: offer.externalId,
    sku: offer.sku,
    category_external_id: offer.categoryExternalId,
    name: offer.name,
    description: offer.description,
    slug: offer.slug,
    source_url: sourceUrl,
    product_url: offer.productUrl,
    price: offer.price,
    currency_id: offer.currencyId,
    available: offer.available,
    params_json: offer.params
  }));

  const result = await client.query(`
    WITH incoming AS (
      SELECT *
      FROM jsonb_to_recordset($1::jsonb) AS product(
        external_id TEXT,
        sku TEXT,
        category_external_id TEXT,
        name TEXT,
        description TEXT,
        slug TEXT,
        source_url TEXT,
        product_url TEXT,
        price NUMERIC,
        currency_id TEXT,
        available BOOLEAN,
        params_json JSONB
      )
    )
    INSERT INTO products (
      external_id, sku, category_external_id, name, slug, source_url, product_url,
      description, price, currency_id, available, is_active, params_json, imported_at, updated_at
    )
    SELECT
      external_id, sku, category_external_id, name, slug, source_url, product_url,
      description, price, currency_id, available, TRUE, params_json, now(), now()
    FROM incoming
    ON CONFLICT (external_id) DO UPDATE SET
      sku = EXCLUDED.sku,
      category_external_id = EXCLUDED.category_external_id,
      name = EXCLUDED.name,
      description = EXCLUDED.description,
      slug = EXCLUDED.slug,
      source_url = EXCLUDED.source_url,
      product_url = EXCLUDED.product_url,
      price = EXCLUDED.price,
      currency_id = EXCLUDED.currency_id,
      available = EXCLUDED.available,
      is_active = TRUE,
      params_json = EXCLUDED.params_json,
      imported_at = now(),
      updated_at = now()
    RETURNING id, external_id
  `, [JSON.stringify(productRows)]);

  const productIds = result.rows.map((row) => row.id);
  const productIdByExternalId = new Map(result.rows.map((row) => [row.external_id, row.id]));
  if (productIds.length) {
    await client.query('DELETE FROM product_images WHERE product_id = ANY($1::uuid[])', [productIds]);
  }

  const imageRows = offers.flatMap((offer) => {
    const productId = productIdByExternalId.get(offer.externalId);
    return offer.pictures.map((remoteUrl, index) => ({
      product_id: productId,
      remote_url: remoteUrl,
      sort_order: index
    }));
  }).filter((image) => image.product_id && image.remote_url);

  if (imageRows.length) {
    await client.query(`
      INSERT INTO product_images (product_id, remote_url, sort_order)
      SELECT product_id, remote_url, sort_order
      FROM jsonb_to_recordset($1::jsonb) AS image(
        product_id UUID,
        remote_url TEXT,
        sort_order INTEGER
      )
    `, [JSON.stringify(imageRows)]);
  }

  return result.rows;
}

async function hideMissing(client, table, seenExternalIds) {
  await client.query('CREATE TEMP TABLE import_seen_external_ids (external_id TEXT PRIMARY KEY) ON COMMIT DROP');
  if (seenExternalIds.length) {
    await client.query('INSERT INTO import_seen_external_ids (external_id) SELECT unnest($1::text[])', [seenExternalIds]);
  }
  const result = await client.query(`
    UPDATE ${table}
    SET is_active = FALSE, updated_at = now()
    WHERE is_active = TRUE
      AND external_id NOT IN (SELECT external_id FROM import_seen_external_ids)
  `);
  await client.query('DROP TABLE import_seen_external_ids');
  return result.rowCount;
}

export async function importDvKeramikFeed({ sourceUrl = process.env.DVKERAMIK_YML_URL || DEFAULT_SOURCE_URL } = {}) {
  const { query, withTransaction } = await import('./db.js');
  const runResult = await query(
    'INSERT INTO import_runs (source_url, status) VALUES ($1, $2) RETURNING id',
    [sourceUrl, 'running']
  );
  const runId = runResult.rows[0].id;
  let parsed = { categories: [], offers: [] };

  try {
    const xml = await fetchFeed(sourceUrl);
    parsed = parseFeed(xml, { sourceUrl });

    const result = await withTransaction(async (client) => {
      const existingProducts = new Set(
        (await client.query('SELECT external_id FROM products')).rows.map((row) => row.external_id)
      );

      await upsertCategories(client, parsed.categories);

      await upsertProducts(client, sourceUrl, parsed.offers);
      const productsCreated = parsed.offers.filter((offer) => !existingProducts.has(offer.externalId)).length;
      const productsUpdated = parsed.offers.length - productsCreated;

      const productsHidden = await hideMissing(client, 'products', parsed.offers.map((offer) => offer.externalId));
      await hideMissing(client, 'categories', parsed.categories.map((category) => category.externalId));

      return {
        runId,
        sourceUrl,
        categoriesTotal: parsed.categories.length,
        offersTotal: parsed.offers.length,
        productsCreated,
        productsUpdated,
        productsHidden
      };
    });

    await query(`
      UPDATE import_runs
      SET finished_at = clock_timestamp(),
          status = 'success',
          categories_total = $2,
          offers_total = $3,
          products_created = $4,
          products_updated = $5,
          products_hidden = $6
      WHERE id = $1
    `, [
      runId,
      parsed.categories.length,
      parsed.offers.length,
      result.productsCreated,
      result.productsUpdated,
      result.productsHidden
    ]);

    return result;
  } catch (error) {
    await query(`
      UPDATE import_runs
      SET finished_at = clock_timestamp(),
          status = 'failed',
          categories_total = $2,
          offers_total = $3,
          error_message = $4
      WHERE id = $1
    `, [
      runId,
      parsed.categories.length,
      parsed.offers.length,
      String(error.message || error).slice(0, 2000)
    ]);
    throw error;
  }
}

export { parseFeed };
