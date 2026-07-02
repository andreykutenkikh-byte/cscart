import { query } from './db.js';

const PAGE_LIMIT_MAX = 60;

function toNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizeText(value) {
  return String(value ?? '').trim().toLowerCase();
}

function asArray(value) {
  if (value === undefined || value === null || value === '') return [];
  return Array.isArray(value) ? value : [value];
}

export function parseCatalogFilters(rawFilters) {
  if (!rawFilters) return { params: {} };
  if (typeof rawFilters === 'object') return { params: rawFilters.params || {}, ...rawFilters };
  try {
    const parsed = JSON.parse(rawFilters);
    return { params: parsed.params || {}, ...parsed };
  } catch {
    return { params: {} };
  }
}

function mapCategoryTree(categories) {
  const nodes = new Map();
  for (const category of categories) {
    nodes.set(category.external_id, {
      id: category.id,
      externalId: category.external_id,
      parentExternalId: category.parent_external_id,
      name: category.name,
      slug: category.slug,
      children: []
    });
  }

  const roots = [];
  for (const node of nodes.values()) {
    if (node.parentExternalId && nodes.has(node.parentExternalId)) {
      nodes.get(node.parentExternalId).children.push(node);
    } else {
      roots.push(node);
    }
  }

  const sortTree = (items) => {
    items.sort((a, b) => a.name.localeCompare(b.name, 'ru'));
    for (const item of items) sortTree(item.children);
  };
  sortTree(roots);
  return roots;
}

export async function getCategories() {
  const result = await query(`
    WITH RECURSIVE product_categories AS (
      SELECT DISTINCT c.external_id
      FROM categories c
      JOIN products p ON p.category_external_id = c.external_id
      WHERE c.is_active = TRUE
        AND p.is_active = TRUE
    ),
    visible_categories AS (
      SELECT c.external_id, c.parent_external_id
      FROM categories c
      JOIN product_categories pc ON pc.external_id = c.external_id

      UNION

      SELECT parent.external_id, parent.parent_external_id
      FROM categories parent
      JOIN visible_categories child ON child.parent_external_id = parent.external_id
      WHERE parent.is_active = TRUE
    )
    SELECT c.id, c.external_id, c.parent_external_id, c.name, c.slug
    FROM categories c
    JOIN visible_categories vc ON vc.external_id = c.external_id
    WHERE c.is_active = TRUE
    ORDER BY c.name
  `);
  return mapCategoryTree(result.rows);
}

async function getCategoryRows() {
  return (await query(`
    SELECT external_id, parent_external_id, name, slug
    FROM categories
    WHERE is_active = TRUE
  `)).rows;
}

function getDescendantCategoryIds(categories, categoryId) {
  if (!categoryId) return [];
  const childrenByParent = new Map();
  for (const category of categories) {
    const key = category.parent_external_id || '';
    if (!childrenByParent.has(key)) childrenByParent.set(key, []);
    childrenByParent.get(key).push(category.external_id);
  }

  const result = [];
  const stack = [categoryId];
  while (stack.length) {
    const current = stack.pop();
    result.push(current);
    for (const child of childrenByParent.get(current) || []) stack.push(child);
  }
  return result;
}

function productMatchesParams(product, paramFilters = {}) {
  const params = product.params_json || {};
  for (const [name, selectedValues] of Object.entries(paramFilters)) {
    const values = asArray(selectedValues).map(normalizeText).filter(Boolean);
    if (!values.length) continue;
    const productValues = asArray(params[name]).map(normalizeText);
    if (!values.some((value) => productValues.includes(value))) {
      return false;
    }
  }
  return true;
}

function productMatchesSearch(product, search) {
  const needle = normalizeText(search);
  if (!needle) return true;
  const haystack = [
    product.name,
    product.sku,
    product.external_id,
    JSON.stringify(product.params_json || {})
  ].join(' ').toLowerCase();
  return haystack.includes(needle);
}

function summarizeProduct(row) {
  return {
    id: row.id,
    externalId: row.external_id,
    sku: row.sku,
    categoryExternalId: row.category_external_id,
    name: row.name,
    description: row.description,
    slug: row.slug,
    productUrl: row.product_url,
    price: row.price === null ? null : Number(row.price),
    currencyId: row.currency_id,
    available: row.available,
    imageUrl: row.image_remote_url,
    remoteImageUrl: row.image_remote_url,
    params: row.params_json || {}
  };
}

async function loadCandidateProducts({ categoryId, search, filters }) {
  const categories = await getCategoryRows();
  const categoryIds = getDescendantCategoryIds(categories, categoryId);
  const values = [];
  const where = ['p.is_active = TRUE'];

  if (categoryIds.length) {
    values.push(categoryIds);
    where.push(`p.category_external_id = ANY($${values.length}::text[])`);
  }
  if (filters.availability === true || filters.availability === 'true') {
    where.push('p.available = TRUE');
  }
  if (filters.availability === false || filters.availability === 'false') {
    where.push('p.available = FALSE');
  }
  if (filters.minPrice !== undefined && filters.minPrice !== '') {
    values.push(Number(filters.minPrice));
    where.push(`p.price >= $${values.length}`);
  }
  if (filters.maxPrice !== undefined && filters.maxPrice !== '') {
    values.push(Number(filters.maxPrice));
    where.push(`p.price <= $${values.length}`);
  }

  const result = await query(`
    SELECT p.*,
      (
        SELECT pi.remote_url
        FROM product_images pi
        WHERE pi.product_id = p.id
        ORDER BY pi.sort_order, pi.id
        LIMIT 1
      ) AS image_remote_url
    FROM products p
    WHERE ${where.join(' AND ')}
    ORDER BY p.available DESC, p.name ASC
  `, values);

  return result.rows.filter((product) =>
    productMatchesSearch(product, search)
    && productMatchesParams(product, filters.params)
  );
}

export async function getProducts(params) {
  const filters = parseCatalogFilters(params.filters);
  const page = Math.max(1, toNumber(params.page, 1));
  const limit = Math.min(PAGE_LIMIT_MAX, Math.max(1, toNumber(params.limit, 24)));
  const products = await loadCandidateProducts({
    categoryId: params.categoryId,
    search: params.search,
    filters
  });
  const offset = (page - 1) * limit;
  const paged = products.slice(offset, offset + limit).map(summarizeProduct);

  return {
    products: paged,
    pagination: {
      page,
      limit,
      total: products.length,
      totalPages: Math.max(1, Math.ceil(products.length / limit)),
      hasNextPage: offset + limit < products.length
    }
  };
}

function buildBreadcrumb(categories, externalId) {
  const map = new Map(categories.map((category) => [category.external_id, category]));
  const result = [];
  let current = map.get(externalId);
  const seen = new Set();
  while (current && !seen.has(current.external_id)) {
    seen.add(current.external_id);
    result.unshift({
      externalId: current.external_id,
      name: current.name,
      slug: current.slug
    });
    current = current.parent_external_id ? map.get(current.parent_external_id) : null;
  }
  return result;
}

export async function getProductDetail(id) {
  const result = await query(`
    SELECT *
    FROM products
    WHERE is_active = TRUE
      AND (id::text = $1 OR external_id = $1 OR sku = $1 OR slug = $1)
    LIMIT 1
  `, [id]);
  const product = result.rows[0];
  if (!product) return null;

  const images = (await query(`
    SELECT id, remote_url, sort_order
    FROM product_images
    WHERE product_id = $1
    ORDER BY sort_order, id
  `, [product.id])).rows;
  const categories = await getCategoryRows();

  return {
    ...summarizeProduct({ ...product, image_remote_url: images[0]?.remote_url || null }),
    sourceUrl: product.source_url,
    images: images.map((image) => ({ id: image.id, remoteUrl: image.remote_url, sortOrder: image.sort_order })),
    breadcrumb: buildBreadcrumb(categories, product.category_external_id)
  };
}

function classifyParam(name) {
  const normalized = normalizeText(name);
  if (/размер|format|size|длина|ширина|толщина/.test(normalized)) return 'size';
  if (/цвет|color/.test(normalized)) return 'color';
  if (/поверх|finish|surface|фактур|матов|глянц|полир/.test(normalized)) return 'surface';
  if (/коллекц|collection|серия/.test(normalized)) return 'collection';
  if (/бренд|brand|vendor|производител|manufacturer/.test(normalized)) return 'brand';
  return 'other';
}

function addCount(map, key) {
  if (!key) return;
  map.set(key, (map.get(key) || 0) + 1);
}

export async function getFacets(params) {
  const filters = parseCatalogFilters(params.filters);
  const products = await loadCandidateProducts({
    categoryId: params.categoryId,
    search: params.search,
    filters: { ...filters, params: {} }
  });

  const categoryCounts = new Map();
  const availabilityCounts = { available: 0, unavailable: 0 };
  const paramCounts = new Map();
  let minPrice = null;
  let maxPrice = null;

  for (const product of products) {
    addCount(categoryCounts, product.category_external_id);
    if (product.available) availabilityCounts.available += 1;
    else availabilityCounts.unavailable += 1;
    if (product.price !== null) {
      const price = Number(product.price);
      minPrice = minPrice === null ? price : Math.min(minPrice, price);
      maxPrice = maxPrice === null ? price : Math.max(maxPrice, price);
    }
    for (const [name, rawValue] of Object.entries(product.params_json || {})) {
      const values = asArray(rawValue).map(String).map((value) => value.trim()).filter(Boolean);
      if (!values.length) continue;
      if (!paramCounts.has(name)) paramCounts.set(name, new Map());
      const valueCounts = paramCounts.get(name);
      for (const value of values) addCount(valueCounts, value);
    }
  }

  const categories = await getCategoryRows();
  const categoryById = new Map(categories.map((category) => [category.external_id, category]));
  const paramFacets = [...paramCounts.entries()]
    .map(([name, counts]) => {
      const values = [...counts.entries()]
        .map(([value, count]) => ({ value, count }))
        .filter((item) => item.value && item.count > 0)
        .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value, 'ru'))
        .slice(0, 40);
      return {
        name,
        group: classifyParam(name),
        values,
        distinctCount: values.length
      };
    })
    .filter((facet) => facet.values.length > 1)
    .sort((a, b) => {
      const groupOrder = ['size', 'color', 'surface', 'collection', 'brand', 'other'];
      return groupOrder.indexOf(a.group) - groupOrder.indexOf(b.group)
        || b.distinctCount - a.distinctCount
        || a.name.localeCompare(b.name, 'ru');
    })
    .filter((facet, index) => facet.group !== 'other' || index < 12);

  return {
    category: [...categoryCounts.entries()]
      .map(([externalId, count]) => ({
        externalId,
        name: categoryById.get(externalId)?.name || externalId,
        count
      }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'ru')),
    availability: availabilityCounts,
    price: { min: minPrice, max: maxPrice },
    params: paramFacets
  };
}
