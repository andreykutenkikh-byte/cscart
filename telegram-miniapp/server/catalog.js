import { query } from './db.js';
import { buildImageVariantUrls } from './media.js';

const PAGE_LIMIT_MAX = 60;
const PRODUCT_SORTS = new Set(['default', 'price_asc', 'price_desc', 'name_asc', 'availability_desc', 'newest']);

function toNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizeText(value) {
  return String(value ?? '').trim().toLowerCase();
}

function normalizeSort(value) {
  return PRODUCT_SORTS.has(value) ? value : 'default';
}

function asArray(value) {
  if (value === undefined || value === null || value === '') return [];
  return Array.isArray(value) ? value : [value];
}

function splitFilterValues(value) {
  return asArray(value)
    .flatMap((item) => String(item).split(','))
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeFilterShape(filters = {}) {
  return {
    ...filters,
    params: Object.fromEntries(
      Object.entries(filters.params || {})
        .map(([name, values]) => [name, splitFilterValues(values)])
        .filter(([, values]) => values.length)
    )
  };
}

export function parseCatalogFilters(rawFilters, queryParams = {}) {
  let filters = { params: {} };
  if (rawFilters && typeof rawFilters === 'object') {
    filters = { params: rawFilters.params || {}, ...rawFilters };
  } else if (rawFilters) {
    try {
      const parsed = JSON.parse(rawFilters);
      filters = { params: parsed.params || {}, ...parsed };
    } catch {
      filters = { params: {} };
    }
  }

  if (queryParams.available !== undefined) filters.availability = queryParams.available;
  if (queryParams.availability !== undefined) filters.availability = queryParams.availability;
  if (queryParams.priceMin !== undefined) filters.minPrice = queryParams.priceMin;
  if (queryParams.priceMax !== undefined) filters.maxPrice = queryParams.priceMax;
  if (queryParams.minPrice !== undefined) filters.minPrice = queryParams.minPrice;
  if (queryParams.maxPrice !== undefined) filters.maxPrice = queryParams.maxPrice;

  for (const [key, value] of Object.entries(queryParams)) {
    const filterParamMatch = key.match(/^filters\[(param:.+)\]$/);
    const directParamMatch = key.match(/^param:(.+)$/);
    const paramsMatch = key.match(/^params\[(.+)\]$/);
    const paramName = filterParamMatch?.[1]?.slice('param:'.length)
      || directParamMatch?.[1]
      || paramsMatch?.[1];
    if (paramName) {
      filters.params = { ...(filters.params || {}), [paramName]: splitFilterValues(value) };
    }
  }

  return normalizeFilterShape(filters);
}

function getAvailabilityFilter(value) {
  if (value === true || value === 'true' || value === 'available') return true;
  if (value === false || value === 'false' || value === 'on_order' || value === 'unavailable') return false;
  return null;
}

function hasFilterValue(value) {
  return value !== undefined && value !== null && value !== '';
}

function optionalNumberFilter(value) {
  if (!hasFilterValue(value)) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function withoutParam(filters, paramName) {
  const params = { ...(filters.params || {}) };
  delete params[paramName];
  return { ...filters, params };
}

function withoutFilterKeys(filters, keys) {
  const result = { ...filters, params: { ...(filters.params || {}) } };
  for (const key of keys) delete result[key];
  return result;
}

function selectedValuesForParam(filters, paramName) {
  return splitFilterValues(filters.params?.[paramName]);
}

function selectedCountForFilters(filters = {}) {
  return Object.values(filters.params || {}).reduce((sum, values) => sum + splitFilterValues(values).length, 0)
    + (hasFilterValue(filters.availability) ? 1 : 0)
    + (hasFilterValue(filters.minPrice) ? 1 : 0)
    + (hasFilterValue(filters.maxPrice) ? 1 : 0);
}

function selectedCountForParam(filters, paramName) {
  return selectedValuesForParam(filters, paramName).length;
}

function selectedCountForAvailability(filters) {
  return hasFilterValue(filters.availability) ? 1 : 0;
}

function selectedCountForPrice(filters) {
  return (optionalNumberFilter(filters.minPrice) !== null ? 1 : 0)
    + (optionalNumberFilter(filters.maxPrice) !== null ? 1 : 0);
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

function compareName(a, b) {
  return String(a.name || '').localeCompare(String(b.name || ''), 'ru', { sensitivity: 'base' })
    || String(a.external_id || '').localeCompare(String(b.external_id || ''), 'ru');
}

function compareAvailability(a, b) {
  return Number(Boolean(b.available)) - Number(Boolean(a.available));
}

function comparePrice(a, b, direction = 1) {
  const left = Number(a.price);
  const right = Number(b.price);
  const leftValid = Number.isFinite(left);
  const rightValid = Number.isFinite(right);
  if (!leftValid && !rightValid) return 0;
  if (!leftValid) return 1;
  if (!rightValid) return -1;
  return (left - right) * direction;
}

function compareImportedAt(a, b) {
  const left = a.imported_at ? new Date(a.imported_at).getTime() : 0;
  const right = b.imported_at ? new Date(b.imported_at).getTime() : 0;
  return right - left;
}

function sortProducts(products, sort) {
  return [...products].sort((a, b) => {
    if (sort === 'price_asc') return comparePrice(a, b, 1) || compareName(a, b);
    if (sort === 'price_desc') return comparePrice(a, b, -1) || compareName(a, b);
    if (sort === 'name_asc') return compareName(a, b);
    if (sort === 'availability_desc') return compareAvailability(a, b) || compareName(a, b);
    if (sort === 'newest') return compareImportedAt(a, b) || compareName(a, b);
    return compareAvailability(a, b) || compareName(a, b);
  });
}

function decorateImage(image) {
  if (!image?.id || !image?.remote_url) return null;
  return {
    id: image.id,
    sortOrder: image.sort_order ?? 0,
    ...buildImageVariantUrls(image)
  };
}

function summarizeProduct(row) {
  const primaryImage = decorateImage({
    id: row.image_id,
    remote_url: row.image_remote_url,
    sort_order: 0
  });

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
    thumbnailUrl: primaryImage?.thumbUrl || row.image_remote_url,
    listImageUrl: primaryImage?.listUrl || row.image_remote_url,
    primaryImage,
    params: row.params_json || {}
  };
}

function uniqueImageRows(images) {
  const seen = new Set();
  return images.filter((image) => {
    if (!image.remote_url || seen.has(image.remote_url)) return false;
    seen.add(image.remote_url);
    return true;
  });
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
  const availabilityFilter = getAvailabilityFilter(filters.availability);
  if (availabilityFilter === true) {
    where.push('p.available = TRUE');
  }
  if (availabilityFilter === false) {
    where.push('p.available = FALSE');
  }
  const minPriceFilter = optionalNumberFilter(filters.minPrice);
  const maxPriceFilter = optionalNumberFilter(filters.maxPrice);
  if (minPriceFilter !== null) {
    values.push(minPriceFilter);
    where.push(`p.price >= $${values.length}`);
  }
  if (maxPriceFilter !== null) {
    values.push(maxPriceFilter);
    where.push(`p.price <= $${values.length}`);
  }

  const result = await query(`
    SELECT p.*,
      primary_image.id::text AS image_id,
      primary_image.remote_url AS image_remote_url
    FROM products p
    LEFT JOIN LATERAL (
      SELECT pi.id, pi.remote_url
      FROM product_images pi
      WHERE pi.product_id = p.id
      ORDER BY pi.sort_order, pi.id
      LIMIT 1
    ) primary_image ON TRUE
    WHERE ${where.join(' AND ')}
    ORDER BY p.available DESC, p.name ASC
  `, values);

  return result.rows.filter((product) =>
    productMatchesSearch(product, search)
    && productMatchesParams(product, filters.params)
  );
}

export async function getProducts(params) {
  const filters = parseCatalogFilters(params.filters, params);
  const page = Math.max(1, toNumber(params.page, 1));
  const limit = Math.min(PAGE_LIMIT_MAX, Math.max(1, toNumber(params.limit, 24)));
  const sort = normalizeSort(params.sort);
  const products = sortProducts(await loadCandidateProducts({
    categoryId: params.categoryId,
    search: params.search,
    filters
  }), sort);
  const offset = (page - 1) * limit;
  const paged = products.slice(offset, offset + limit).map(summarizeProduct);
  const hasNextPage = offset + limit < products.length;

  return {
    products: paged,
    pagination: {
      page,
      limit,
      sort,
      total: products.length,
      totalPages: Math.max(1, Math.ceil(products.length / limit)),
      hasNextPage,
      hasMore: hasNextPage,
      nextPage: hasNextPage ? page + 1 : null
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

  const images = uniqueImageRows((await query(`
    SELECT id::text AS id, remote_url, sort_order
    FROM product_images
    WHERE product_id = $1
    ORDER BY sort_order, id
  `, [product.id])).rows);
  const categories = await getCategoryRows();

  return {
    ...summarizeProduct({ ...product, image_id: images[0]?.id || null, image_remote_url: images[0]?.remote_url || null }),
    sourceUrl: product.source_url,
    images: images.map(decorateImage).filter(Boolean),
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

function groupSortRank(name) {
  const normalized = normalizeText(name);
  if (/размер|format|size/.test(normalized)) return 10;
  if (/толщин/.test(normalized)) return 20;
  if (/цвет мозаик/.test(normalized)) return 30;
  if (/цвет|color/.test(normalized)) return 40;
  if (/поверх|finish|surface|фактур|матов|глянц|полир/.test(normalized)) return 50;
  if (/коллекц|collection|серия/.test(normalized)) return 60;
  if (/vendor|бренд|brand|производител|manufacturer/.test(normalized)) return 70;
  if (/страна|country/.test(normalized)) return 80;
  return 100;
}

function makeAvailabilityGroup(products, filters) {
  const availableCount = products.filter((product) => product.available).length;
  const unavailableCount = products.length - availableCount;
  const selected = getAvailabilityFilter(filters.availability);
  const options = [
    { value: 'available', label: 'В наличии', count: availableCount, selected: selected === true },
    { value: 'on_order', label: 'Под заказ', count: unavailableCount, selected: selected === false }
  ].filter((option) => option.count > 0 || option.selected);

  if (!options.length) return null;
  return {
    key: 'availability',
    label: 'Наличие',
    type: 'checkbox',
    selectedCount: selectedCountForAvailability(filters),
    totalOptions: options.length,
    options
  };
}

function makePriceGroup(products, filters) {
  const prices = products
    .map((product) => Number(product.price))
    .filter((price) => Number.isFinite(price));
  if (!prices.length && !selectedCountForPrice(filters)) return null;
  const selectedMin = optionalNumberFilter(filters.minPrice);
  const selectedMax = optionalNumberFilter(filters.maxPrice);
  return {
    key: 'price',
    label: 'Цена',
    type: 'range',
    selectedCount: selectedCountForPrice(filters),
    min: prices.length ? Math.min(...prices) : null,
    max: prices.length ? Math.max(...prices) : null,
    selectedMin,
    selectedMax
  };
}

function makeParamGroup(name, valueCounts, filters) {
  const selectedValues = new Set(selectedValuesForParam(filters, name));
  const optionsByValue = new Map(
    [...valueCounts.entries()].map(([value, count]) => [
      value,
      { value, label: value, count, selected: selectedValues.has(value) }
    ])
  );

  for (const value of selectedValues) {
    if (!optionsByValue.has(value)) {
      optionsByValue.set(value, { value, label: value, count: 0, selected: true });
    }
  }

  const options = [...optionsByValue.values()]
    .filter((option) => option.count > 0 || option.selected)
    .sort((a, b) => Number(b.selected) - Number(a.selected) || b.count - a.count || a.label.localeCompare(b.label, 'ru'));

  if (!options.length) return null;
  return {
    key: `param:${name}`,
    paramName: name,
    label: name,
    group: classifyParam(name),
    type: 'checkbox',
    selectedCount: selectedCountForParam(filters, name),
    totalOptions: options.length,
    options
  };
}

function countParamValues(products) {
  const paramCounts = new Map();
  for (const product of products) {
    for (const [name, rawValue] of Object.entries(product.params_json || {})) {
      const values = asArray(rawValue).map(String).map((value) => value.trim()).filter(Boolean);
      if (!values.length) continue;
      if (!paramCounts.has(name)) paramCounts.set(name, new Map());
      const valueCounts = paramCounts.get(name);
      for (const value of values) addCount(valueCounts, value);
    }
  }
  return paramCounts;
}

function countValuesForParam(products, paramName) {
  const valueCounts = new Map();
  for (const product of products) {
    const values = asArray(product.params_json?.[paramName]).map(String).map((value) => value.trim()).filter(Boolean);
    for (const value of values) addCount(valueCounts, value);
  }
  return valueCounts;
}

export async function getFacets(params) {
  const filters = parseCatalogFilters(params.filters, params);
  const products = await loadCandidateProducts({
    categoryId: params.categoryId,
    search: params.search,
    filters: { ...filters, params: {} }
  });
  const appliedProducts = products.filter((product) => productMatchesParams(product, filters.params));
  let availabilityProducts = appliedProducts;
  let priceProducts = appliedProducts;

  const categoryCounts = new Map();
  if (hasFilterValue(filters.availability)) {
    const baseProductsWithoutAvailability = await loadCandidateProducts({
      categoryId: params.categoryId,
      search: params.search,
      filters: { ...withoutFilterKeys(filters, ['availability']), params: {} }
    });
    availabilityProducts = baseProductsWithoutAvailability.filter((product) => productMatchesParams(product, filters.params));
  }
  if (hasFilterValue(filters.minPrice) || hasFilterValue(filters.maxPrice)) {
    const baseProductsWithoutPrice = await loadCandidateProducts({
      categoryId: params.categoryId,
      search: params.search,
      filters: { ...withoutFilterKeys(filters, ['minPrice', 'maxPrice']), params: {} }
    });
    priceProducts = baseProductsWithoutPrice.filter((product) => productMatchesParams(product, filters.params));
  }
  let minPrice = null;
  let maxPrice = null;

  for (const product of products) {
    addCount(categoryCounts, product.category_external_id);
    if (product.price !== null) {
      const price = Number(product.price);
      minPrice = minPrice === null ? price : Math.min(minPrice, price);
      maxPrice = maxPrice === null ? price : Math.max(maxPrice, price);
    }
  }

  const categories = await getCategoryRows();
  const categoryById = new Map(categories.map((category) => [category.external_id, category]));
  const baseParamCounts = countParamValues(products);
  const hasSelectedParams = Object.keys(filters.params || {}).length > 0;
  const allParamNames = new Set([
    ...Object.keys(filters.params || {}),
    ...products.flatMap((product) => Object.keys(product.params_json || {}))
  ]);
  const paramGroupEntries = [...allParamNames]
    .map((name) => {
      const valueCounts = hasSelectedParams
        ? countValuesForParam(products.filter((product) => productMatchesParams(product, withoutParam(filters, name).params)), name)
        : baseParamCounts.get(name);
      return makeParamGroup(name, valueCounts || new Map(), filters);
    })
    .filter(Boolean)
    .filter((group) => group.options.length > 1 || group.selectedCount > 0)
    .sort((a, b) => groupSortRank(a.label) - groupSortRank(b.label)
      || b.totalOptions - a.totalOptions
      || a.label.localeCompare(b.label, 'ru'));

  const availabilityGroup = makeAvailabilityGroup(availabilityProducts, filters);
  const priceGroup = makePriceGroup(priceProducts, filters);
  const groups = [
    availabilityGroup,
    priceGroup,
    ...paramGroupEntries
  ].filter(Boolean);

  const availabilityCounts = {
    available: availabilityGroup?.options.find((option) => option.value === 'available')?.count || 0,
    unavailable: availabilityGroup?.options.find((option) => option.value === 'on_order')?.count || 0
  };
  const paramCounts = baseParamCounts;
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
    total: appliedProducts.length,
    selectedCount: selectedCountForFilters(filters),
    groups,
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
