import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Home, LayoutGrid, List as ListIcon, ShoppingCart, ClipboardList, Search, SlidersHorizontal, ChevronLeft, ChevronRight, ArrowLeft, X, Plus, Minus } from 'lucide-react';
import { apiGet, apiPost } from './api.js';
import { addToCart, clearCart, getCartItems, getCartTotal, loadCart, saveCart, updateQuantity } from './cart.js';
import { getPlatform } from './platform/index.js';
import './styles.css';

const platform = getPlatform();
const CATALOG_PAGE_LIMIT = 24;
const CATALOG_VIEW_MODE_KEY = 'dvkeramik.catalog.viewMode';

const SORT_OPTIONS = [
  { value: 'default', label: 'По умолчанию' },
  { value: 'price_asc', label: 'Сначала дешевле' },
  { value: 'price_desc', label: 'Сначала дороже' },
  { value: 'name_asc', label: 'По названию' },
  { value: 'availability_desc', label: 'Сначала в наличии' },
  { value: 'newest', label: 'Недавно обновленные' }
];

const DEFAULT_BRAND = {
  title: 'ДВ Керамик',
  subtitle: 'каталог обновляется ежедневно',
  logoUrl: '',
  initials: 'ДК'
};

function loadCatalogViewMode() {
  try {
    const value = window.localStorage.getItem(CATALOG_VIEW_MODE_KEY);
    return value === 'grid' || value === 'list' ? value : 'list';
  } catch {
    return 'list';
  }
}

const MAIN_MENU_META = [
  ['2873', 'Керамическая плитка', 'Более 1500 наименований керамической плитки'],
  ['2877', 'Керамогранит', 'Высокопрочный настенный и напольный керамогранит'],
  ['2867', 'Мозаика', 'Большой выбор декоративной мозаики'],
  ['2895', 'Строительные смеси', 'Строительные смеси любого назначения'],
  ['3022', 'Краска', 'Износостойкие краски для наружных и внутренних работ'],
  ['2986', 'Мебель и сантехника', 'Мебель и сантехника для ванных комнат'],
  ['3137', 'Современные решения', 'Инновационные материалы для тех, кто ценит дизайн'],
  ['3212', 'Архитектурное стекло', 'Стеклоблоки и архитектурные решения']
];

const MAIN_MENU_META_BY_ID = new Map(MAIN_MENU_META.map(([externalId, title, description], index) => [
  externalId,
  { title, description, order: index }
]));

const HIDDEN_MENU_CATEGORY_RE = /(скид|распродаж|снижение\s+цены|архив)/i;

function formatPrice(value, currency = 'RUB') {
  if (value === null || value === undefined) return 'Цена по запросу';
  const symbol = currency === 'RUB' ? '₽' : currency || '';
  return `${Number(value).toLocaleString('ru-RU')} ${symbol}`.trim();
}

function formatProductPrice(product) {
  if (!product) return formatPrice(null);
  if (product.unitPricing?.canToggleUnits && product.unitPricing.m2Label) return product.unitPricing.m2Label;
  const formatted = formatPrice(product.price, product.currencyId);
  return formatted;
}

function formatDisplayTitle(name = '') {
  const value = String(name || '').trim();
  if (!value) return '';
  const letters = value.match(/[A-Za-zА-Яа-яЁё]/g) || [];
  const uppercaseLetters = value.match(/[A-ZА-ЯЁ]/g) || [];
  const lowercaseLetters = value.match(/[a-zа-яё]/g) || [];
  const looksAllCaps = letters.length >= 8 && uppercaseLetters.length > lowercaseLetters.length * 3;

  if (!looksAllCaps) return value;

  return value.replace(/[А-ЯЁ]{4,}/g, (word) => {
    const lower = word.toLocaleLowerCase('ru-RU');
    return `${lower.charAt(0).toLocaleUpperCase('ru-RU')}${lower.slice(1)}`;
  });
}

function getProductImages(product) {
  const candidates = [
    ...(product?.images || []),
    product?.primaryImage,
    {
      id: product?.primaryImage?.id,
      remoteUrl: product?.remoteImageUrl || product?.imageUrl,
      thumbUrl: product?.thumbnailUrl,
      listUrl: product?.listImageUrl,
      detailUrl: product?.primaryImage?.detailUrl,
      viewerUrl: product?.primaryImage?.viewerUrl
    }
  ].filter(Boolean);
  const seen = new Set();
  return candidates
    .map((image, index) => {
      const remoteUrl = image.remoteUrl || image.remote_url || image.url;
      if (!remoteUrl || seen.has(remoteUrl)) return null;
      seen.add(remoteUrl);
      return {
        id: image.id || `${remoteUrl}-${index}`,
        remoteUrl,
        thumbUrl: image.thumbUrl || image.thumbnailUrl || image.listUrl || remoteUrl,
        listUrl: image.listUrl || image.thumbUrl || remoteUrl,
        detailUrl: image.detailUrl || image.listUrl || remoteUrl,
        viewerUrl: image.viewerUrl || image.detailUrl || image.listUrl || remoteUrl
      };
    })
    .filter(Boolean);
}

function flattenCategories(categories, depth = 0) {
  return categories.flatMap((category) => [
    { ...category, depth },
    ...flattenCategories(category.children || [], depth + 1)
  ]);
}

function getHomeCategories(categories) {
  if (categories.length === 1 && categories[0].children?.length) {
    return categories[0].children;
  }
  return categories;
}

function isHiddenMenuCategory(category) {
  return HIDDEN_MENU_CATEGORY_RE.test(category?.name || '');
}

function pruneMenuCategory(category) {
  if (!category || isHiddenMenuCategory(category)) return null;
  const meta = MAIN_MENU_META_BY_ID.get(category.externalId);
  const children = (category.children || [])
    .map(pruneMenuCategory)
    .filter(Boolean);

  return {
    ...category,
    displayName: meta?.title || category.name,
    menuDescription: meta?.description || '',
    children
  };
}

function getCatalogMenuCategories(categories) {
  const roots = getHomeCategories(categories)
    .map(pruneMenuCategory)
    .filter(Boolean);
  const rootsById = new Map(roots.map((category) => [category.externalId, category]));
  const ordered = [];

  for (const [externalId] of MAIN_MENU_META) {
    const category = rootsById.get(externalId);
    if (category) {
      ordered.push(category);
    }
  }

  return ordered;
}

function getCategoryCards(categories, facets) {
  const facetCategories = facets?.category || [];
  if (facetCategories.length) return facetCategories.slice(0, 8);
  return getHomeCategories(categories).slice(0, 8).map((category) => ({
    externalId: category.externalId,
    name: category.name,
    count: null
  }));
}

function getProductMeta(product) {
  const params = product?.params || {};
  return params['Размер материала'] || params['Размер'] || params['Материал'] || product?.sku || '';
}

function getQuickFacets(facets) {
  const chips = [];
  if (facets?.availability?.available) {
    chips.push({ type: 'availability', label: 'В наличии', value: 'true' });
  }
  const preferredGroups = ['size', 'surface', 'color'];
  const params = (facets?.params || [])
    .filter((facet) => preferredGroups.includes(facet.group))
    .slice(0, 4);
  for (const facet of params) {
    for (const item of facet.values.slice(0, 2)) {
      chips.push({ type: 'param', label: item.value, facet: facet.name, value: item.value });
      if (chips.length >= 8) return chips;
    }
  }
  return chips;
}

function cloneFilters(filters = {}) {
  const params = Object.fromEntries(
    Object.entries(filters.params || {}).map(([name, values]) => [
      name,
      Array.isArray(values) ? [...values] : [values].filter(Boolean)
    ])
  );
  return { ...filters, params };
}

function countSelectedFilters(filters = {}) {
  const paramsCount = Object.values(filters.params || {}).reduce((sum, values) => (
    sum + (Array.isArray(values) ? values.length : values ? 1 : 0)
  ), 0);
  return paramsCount
    + (filters.availability ? 1 : 0)
    + (filters.minPrice ? 1 : 0)
    + (filters.maxPrice ? 1 : 0);
}

function getFacetGroups(facets) {
  if (facets?.groups?.length) return facets.groups;
  const groups = [];
  if (facets?.availability) {
    groups.push({
      key: 'availability',
      label: 'Наличие',
      type: 'checkbox',
      selectedCount: 0,
      options: [
        { value: 'available', label: 'В наличии', count: facets.availability.available || 0 },
        { value: 'on_order', label: 'Под заказ', count: facets.availability.unavailable || 0 }
      ].filter((option) => option.count > 0)
    });
  }
  if (facets?.price && facets.price.min !== null && facets.price.min !== undefined) {
    groups.push({ key: 'price', label: 'Цена', type: 'range', min: facets.price.min, max: facets.price.max, selectedMin: null, selectedMax: null });
  }
  for (const facet of facets?.params || []) {
    groups.push({
      key: `param:${facet.name}`,
      paramName: facet.name,
      label: facet.name,
      type: 'checkbox',
      selectedCount: 0,
      options: facet.values.map((item) => ({ value: item.value, label: item.value, count: item.count }))
    });
  }
  return groups;
}

function findFacetOption(groups, groupKey, value) {
  return groups
    .find((group) => group.key === groupKey)
    ?.options
    ?.find((option) => option.value === value);
}

function getSelectedFilterItems(filters = {}, facets) {
  const groups = getFacetGroups(facets);
  const items = [];
  if (filters.availability) {
    const value = filters.availability === 'false' || filters.availability === false ? 'on_order' : 'available';
    const option = findFacetOption(groups, 'availability', value);
    items.push({ id: 'availability', type: 'availability', groupKey: 'availability', label: option?.label || (value === 'available' ? 'В наличии' : 'Под заказ'), groupLabel: 'Наличие' });
  }
  if (filters.minPrice) {
    items.push({ id: 'minPrice', type: 'minPrice', label: `от ${filters.minPrice}`, groupLabel: 'Цена' });
  }
  if (filters.maxPrice) {
    items.push({ id: 'maxPrice', type: 'maxPrice', label: `до ${filters.maxPrice}`, groupLabel: 'Цена' });
  }
  for (const [paramName, values] of Object.entries(filters.params || {})) {
    for (const value of Array.isArray(values) ? values : [values]) {
      const groupKey = `param:${paramName}`;
      const option = findFacetOption(groups, groupKey, value);
      items.push({
        id: `${groupKey}:${value}`,
        type: 'param',
        groupKey,
        paramName,
        value,
        label: option?.label || value,
        groupLabel: groups.find((group) => group.key === groupKey)?.label || paramName
      });
    }
  }
  return items;
}

function removeFilterItem(filters, item) {
  const next = cloneFilters(filters);
  if (item.type === 'availability') delete next.availability;
  if (item.type === 'minPrice') delete next.minPrice;
  if (item.type === 'maxPrice') delete next.maxPrice;
  if (item.type === 'param') {
    const current = new Set(next.params?.[item.paramName] || []);
    current.delete(item.value);
    next.params = { ...(next.params || {}), [item.paramName]: [...current] };
    if (!next.params[item.paramName].length) delete next.params[item.paramName];
  }
  return next;
}

function useDebouncedValue(value, delay = 300) {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedValue(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);

  return debouncedValue;
}

function initialViewFromPath() {
  const path = window.location.pathname;
  if (path === '/admin/settings') return 'adminSettings';
  if (path === '/admin/visitors') return 'adminVisitors';
  if (path === '/admin/orders') return 'adminOrders';
  if (path === '/admin') return 'admin';
  if (path === '/catalog') return 'catalogMenu';
  return 'home';
}

function formatDateTime(value) {
  if (!value) return 'нет данных';
  return new Date(value).toLocaleString('ru-RU');
}

function formatOrderStatus(status) {
  const statuses = {
    new: 'Новая',
    processing: 'В работе',
    done: 'Завершена',
    canceled: 'Отменена'
  };
  return statuses[status] || status || 'нет статуса';
}

function ProductImage({ src, fallbackSrc, alt, loading = 'lazy' }) {
  const sources = useMemo(() => [...new Set([src, fallbackSrc].filter(Boolean))], [src, fallbackSrc]);
  const [sourceIndex, setSourceIndex] = useState(0);
  useEffect(() => setSourceIndex(0), [sources.join('|')]);
  if (!sources.length || sourceIndex >= sources.length) return <div className="image-fallback">DV</div>;
  return (
    <img
      src={sources[sourceIndex]}
      alt={alt}
      loading={loading}
      decoding="async"
      onError={() => {
        setSourceIndex((current) => current + 1);
      }}
    />
  );
}

function BrandMark({ brand = DEFAULT_BRAND }) {
  const logoUrl = String(brand.logoUrl || '').trim();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [logoUrl]);

  if (logoUrl && !failed) {
    return (
      <span className="brand-mark brand-mark--image">
        <img src={logoUrl} alt={brand.title || DEFAULT_BRAND.title} onError={() => setFailed(true)} />
      </span>
    );
  }

  return <span className="brand-mark">{brand.initials || DEFAULT_BRAND.initials}</span>;
}

function AppHeader({ cartCount = 0, setView, brand = DEFAULT_BRAND }) {
  const title = brand.title || DEFAULT_BRAND.title;
  const subtitle = brand.subtitle || DEFAULT_BRAND.subtitle;
  const logoUrl = String(brand.logoUrl || '').trim();
  const [fullLogoFailed, setFullLogoFailed] = useState(false);

  useEffect(() => {
    setFullLogoFailed(false);
  }, [logoUrl]);

  const showFullLogo = Boolean(logoUrl && !fullLogoFailed);

  return (
    <header className="app-header">
      <button className={`brand-lockup${showFullLogo ? ' brand-lockup--logo-only' : ''}`} onClick={() => setView('home')} aria-label="На главную">
        {showFullLogo ? (
          <img className="brand-logo-full" src={logoUrl} alt={title} onError={() => setFullLogoFailed(true)} />
        ) : (
          <>
            <BrandMark brand={brand} />
            <span>
              <strong>{title}</strong>
              <small>{subtitle}</small>
            </span>
          </>
        )}
      </button>
      <button className="header-action" onClick={() => setView('cart')} aria-label="Открыть корзину">
        <ShoppingCart size={18} />
        {cartCount > 0 ? <b>{cartCount}</b> : null}
      </button>
    </header>
  );
}

function UnitPriceDisplay({ product, variant = 'card' }) {
  const unitPricing = product?.unitPricing?.canToggleUnits ? product.unitPricing : null;
  const [unit, setUnit] = useState(unitPricing?.defaultUnit || 'm2');

  useEffect(() => {
    setUnit(unitPricing?.defaultUnit || 'm2');
  }, [unitPricing?.defaultUnit, product?.externalId]);

  if (!unitPricing) {
    return <strong>{formatProductPrice(product)}</strong>;
  }

  const isPiece = unit === 'piece';
  const primaryLabel = isPiece ? unitPricing.pieceLabel : unitPricing.m2Label;
  const secondaryLabel = isPiece ? unitPricing.m2Label : unitPricing.pieceLabel;

  return (
    <div className={`unit-price unit-price--${variant}`}>
      <div className="unit-price__main">
        <strong>{primaryLabel}</strong>
        <small>{secondaryLabel}</small>
      </div>
      <div className="unit-switcher" role="group" aria-label="Единица цены">
        <button type="button" className={!isPiece ? 'active' : ''} onClick={(event) => { event.stopPropagation(); setUnit('m2'); }}>м²</button>
        <button type="button" className={isPiece ? 'active' : ''} onClick={(event) => { event.stopPropagation(); setUnit('piece'); }}>шт</button>
      </div>
    </div>
  );
}

function ProductCard({ product, onOpen, onAdd, viewMode = 'list' }) {
  if (!product) return null;
  const displayName = formatDisplayTitle(product.name);
  const cardImageFallback = product.remoteImageUrl || product.imageUrl;
  const modeClass = viewMode === 'grid' ? 'product-card--grid' : 'product-card--list';
  const availabilityLabel = product.available ? 'В наличии' : 'Под заказ';
  const openProduct = () => onOpen(product);
  const handleOpenKeyDown = (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    openProduct();
  };

  return (
    <article className={`product-card ${modeClass}`}>
      <div className="product-card__open" role="button" tabIndex={0} onClick={openProduct} onKeyDown={handleOpenKeyDown}>
        <div className="product-card__image">
          <ProductImage src={product.listImageUrl || product.thumbnailUrl || cardImageFallback} fallbackSrc={cardImageFallback} alt={product.name} />
        </div>
        <div className="product-card__body">
          <div className="product-card__name">{displayName}</div>
          <div className="product-card__meta">{getProductMeta(product)}</div>
          <div className={`product-card__stock ${product.available ? 'available' : ''}`}>{availabilityLabel}</div>
          <div className="product-card__bottom">
            <UnitPriceDisplay product={product} variant="card" />
          </div>
        </div>
      </div>
      {onAdd ? (
        <button className="product-card__cart" type="button" onClick={() => onAdd(product)} aria-label={`Добавить в корзину ${product.name}`}>
          <ShoppingCart size={15} />
          <span>В корзину</span>
        </button>
      ) : null}
    </article>
  );
}

function BottomNav({ view, setView, cartCount, showOrders }) {
  const items = [
    ['home', 'Главная', Home],
    ['catalogMenu', 'Каталог', LayoutGrid],
    ['cart', 'Корзина', ShoppingCart]
  ];
  if (showOrders) {
    items.push(['orders', 'Заявки', ClipboardList]);
  }
  return (
    <nav className="bottom-nav" style={{ '--nav-count': items.length }}>
      {items.map(([id, label, Icon]) => (
        <button key={id} className={view === id || (id === 'catalogMenu' && view === 'catalog') ? 'active' : ''} onClick={() => setView(id)}>
          <Icon size={20} />
          <span>{label}</span>
          {id === 'cart' && cartCount > 0 ? <b>{cartCount}</b> : null}
        </button>
      ))}
    </nav>
  );
}

function HomeBannerCarousel({ banners = [] }) {
  const visibleBanners = banners.filter((banner) => banner?.imageUrl);
  const [activeIndex, setActiveIndex] = useState(0);
  const touchStartX = useRef(null);

  useEffect(() => {
    setActiveIndex(0);
  }, [visibleBanners.map((banner) => banner.id).join('|')]);

  if (!visibleBanners.length) return null;

  const safeActiveIndex = activeIndex % visibleBanners.length;
  const goTo = (index) => setActiveIndex((index + visibleBanners.length) % visibleBanners.length);
  const renderBanner = (banner, index) => {
    const image = <img src={banner.imageUrl} alt={banner.title || 'DV Keramik banner'} loading={index === 0 ? 'eager' : 'lazy'} decoding="async" />;
    const className = 'home-banner-slide';

    if (banner.targetUrl) {
      return (
        <a key={banner.id} className={className} href={banner.targetUrl} target="_blank" rel="noreferrer">
          {image}
        </a>
      );
    }

    return <div key={banner.id} className={className}>{image}</div>;
  };

  return (
    <section
      className="home-banners"
      onTouchStart={(event) => {
        touchStartX.current = event.touches[0]?.clientX ?? null;
      }}
      onTouchEnd={(event) => {
        if (touchStartX.current === null || visibleBanners.length < 2) return;
        const delta = (event.changedTouches[0]?.clientX ?? touchStartX.current) - touchStartX.current;
        touchStartX.current = null;
        if (Math.abs(delta) < 36) return;
        goTo(activeIndex + (delta < 0 ? 1 : -1));
      }}
    >
      <div className="home-banner-frame" aria-live="polite">
        <div
          className="home-banner-track"
          style={{ transform: `translate3d(-${safeActiveIndex * 100}%, 0, 0)` }}
        >
          {visibleBanners.map(renderBanner)}
        </div>
      </div>
      {visibleBanners.length > 1 ? (
        <div className="home-banner-dots" aria-label="Баннеры">
          {visibleBanners.map((banner, index) => (
            <button
              key={banner.id}
              className={index === safeActiveIndex ? 'active' : ''}
              type="button"
              onClick={() => goTo(index)}
              aria-label={`Показать баннер ${index + 1}`}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
}

function HomeScreen({ categories, facets, products, search, setSearch, setCategoryId, setFilters, setView, onOpen, cartCount, brand, homeBanners, loading }) {
  const categoryCards = getCategoryCards(categories, facets).slice(0, 4);
  const quickFacets = getQuickFacets(facets).slice(0, 4);
  const visibleProducts = products.filter(Boolean);
  const isSearchMode = Boolean(search.trim());
  const featuredProduct = visibleProducts.find((product) => product.listImageUrl || product.remoteImageUrl || product.imageUrl) || visibleProducts[0];
  const featuredImageFallback = featuredProduct?.remoteImageUrl || featuredProduct?.imageUrl;

  const handleSearchChange = (event) => {
    setSearch(event.target.value);
    setCategoryId('');
    setFilters({ params: {} });
  };

  const applyQuickFacet = (chip) => {
    if (chip.type === 'availability') {
      setFilters({ params: {}, availability: chip.value });
    } else {
      setFilters({ params: { [chip.facet]: [chip.value] } });
    }
    setView('catalog');
  };

  return (
    <main className="screen">
      <AppHeader cartCount={cartCount} setView={setView} brand={brand} />
      <label className="search-box">
        <Search size={18} />
        <input value={search} onChange={handleSearchChange} placeholder="Найти плитку, коллекцию, размер..." />
      </label>
      {isSearchMode ? (
        <section>
          <div className="section-title">
            <h2>Результаты поиска</h2>
            {!loading ? <span>{visibleProducts.length} позиций</span> : null}
          </div>
          {loading ? <div className="empty">Ищем товары...</div> : null}
          {!loading && !visibleProducts.length ? <div className="empty">Ничего не найдено</div> : null}
          <div className="product-list product-list--list">
            {!loading ? visibleProducts.map((product) => <ProductCard key={product.externalId} product={product} onOpen={onOpen} />) : null}
          </div>
        </section>
      ) : (
        <>
      {homeBanners?.length ? (
        <HomeBannerCarousel banners={homeBanners} />
      ) : (
        <section className="hero">
          <div>
            <h1>Каталог плитки с актуальными остатками</h1>
            <p>Категории и фильтры собираются из файла импорта.</p>
            <button onClick={() => setView('catalogMenu')}>В каталог</button>
          </div>
          <div className="hero__media">
            <ProductImage src={featuredProduct?.listImageUrl || featuredProduct?.thumbnailUrl || featuredImageFallback} fallbackSrc={featuredImageFallback} alt={featuredProduct?.name || 'Плитка'} />
          </div>
        </section>
      )}
      <section>
        <div className="section-title"><h2>Разделы из выгрузки</h2></div>
        <div className="category-grid">
          {categoryCards.map((category, index) => (
            <button key={category.externalId} onClick={() => { setCategoryId(category.externalId); setView('catalog'); }}>
              <span className="category-icon"><LayoutGrid size={17} /></span>
              <span className="category-copy">
                <strong>{category.name}</strong>
                <small>{category.count ? `${category.count} товаров` : 'из categoryId'}</small>
              </span>
              {index === 0 ? <ChevronRight className="category-arrow" size={14} /> : null}
            </button>
          ))}
        </div>
      </section>
      {quickFacets.length ? (
        <section>
          <div className="section-title"><h2>Быстрый подбор</h2></div>
          <div className="chips">
            {quickFacets.map((chip, index) => (
              <button className={index === 0 ? 'selected' : ''} key={`${chip.type}:${chip.facet || ''}:${chip.value}`} onClick={() => applyQuickFacet(chip)}>
                {chip.label}
              </button>
            ))}
          </div>
        </section>
      ) : null}
      <section>
        <div className="section-title"><h2>Популярное из offers</h2><button onClick={() => setView('catalog')}>Все</button></div>
        <div className="product-list">
          {visibleProducts.slice(0, 6).map((product) => <ProductCard key={product.externalId} product={product} onOpen={onOpen} />)}
        </div>
      </section>
        </>
      )}
    </main>
  );
}

function CatalogScreen({
  categoriesFlat,
  categoryId,
  setCategoryId,
  products,
  pagination,
  facets,
  filters,
  setFilters,
  search,
  setSearch,
  setView,
  onOpen,
  onAdd,
  onOpenFilters,
  onLoadMore,
  loading,
  loadingMore,
  loadError,
  cartCount,
  sort,
  setSort,
  viewMode,
  setViewMode,
  brand
}) {
  const selectedCategory = categoriesFlat.find((category) => category.externalId === categoryId);
  const categoryChips = (facets?.category || []).slice(0, 10);
  const selectedFilterItems = getSelectedFilterItems(filters, facets);
  const visibleProducts = products.filter(Boolean);
  const productListClassName = `product-list product-list--${viewMode === 'grid' ? 'grid' : 'list'}`;

  return (
    <main className="screen">
      <AppHeader cartCount={cartCount} setView={setView} brand={brand} />
      <div className="toolbar catalog-toolbar">
        <label className="search-box compact">
          <Search size={18} />
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Поиск по offers" />
        </label>
      </div>
      <div className="breadcrumb">{selectedCategory ? `Каталог / ${selectedCategory.name}` : 'Каталог / все категории'}</div>
      {selectedFilterItems.length ? (
        <section className="selected-filters-panel">
          <div className="selected-filters-panel__head">
            <span>Выбрано</span>
            <button onClick={() => setFilters({ params: {} })}>очистить</button>
          </div>
          <div className="selected-filter-chips">
            {selectedFilterItems.slice(0, 8).map((item) => (
              <button key={item.id} onClick={() => setFilters(removeFilterItem(filters, item))}>
                <span>{item.label}</span>
                <X size={13} />
              </button>
            ))}
          </div>
        </section>
      ) : null}
      <div className="chips category-chips">
        <button className={!categoryId ? 'selected' : ''} onClick={() => setCategoryId('')}>Все</button>
        {categoryChips.map((category) => (
          <button key={category.externalId} className={categoryId === category.externalId ? 'selected' : ''} onClick={() => setCategoryId(category.externalId)}>
            {category.name}
          </button>
        ))}
      </div>
      <div className="catalog-controls">
        <label className="catalog-sort">
          <span>Сортировка</span>
          <select value={sort} onChange={(event) => setSort(event.target.value)}>
            {SORT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
        <div className="view-toggle" role="group" aria-label="Вид каталога">
          <button
            type="button"
            className={viewMode === 'list' ? 'active' : ''}
            onClick={() => setViewMode('list')}
            aria-label="Список"
          >
            <ListIcon size={16} />
          </button>
          <button
            type="button"
            className={viewMode === 'grid' ? 'active' : ''}
            onClick={() => setViewMode('grid')}
            aria-label="Плитка"
          >
            <LayoutGrid size={16} />
          </button>
        </div>
      </div>
      <div className="result-row">
        <h1>{selectedCategory?.name || 'Товары по фильтру'}</h1>
        <span>{pagination?.total ?? products.length} позиций</span>
      </div>
      {loading ? <div className="empty">Загружаем каталог...</div> : null}
      {!loading && !visibleProducts.length ? <div className="empty">Ничего не найдено</div> : null}
      <div className={productListClassName}>
        {visibleProducts.map((product) => (
          <ProductCard
            key={product.externalId}
            product={product}
            onOpen={onOpen}
            onAdd={onAdd}
            viewMode={viewMode}
          />
        ))}
      </div>
      {loadError ? (
        <div className="load-more-state">
          <span>{loadError}</span>
          <button type="button" onClick={onLoadMore}>Повторить</button>
        </div>
      ) : null}
      {pagination?.hasMore || pagination?.hasNextPage ? (
        <button className="load-more-button" type="button" onClick={onLoadMore} disabled={loadingMore || loading}>
          {loadingMore ? 'Загружаем...' : 'Показать ещё'}
        </button>
      ) : null}
      {!loading && visibleProducts.length && pagination && !(pagination.hasMore || pagination.hasNextPage) ? (
        <div className="end-note">Все товары показаны</div>
      ) : null}
    </main>
  );
}

function CatalogMenuItem({ category, level, expanded, onToggle, onOpen }) {
  const hasChildren = Boolean(category.children?.length);
  const isExpanded = expanded.has(category.externalId);
  const depth = Math.min(level, 4);

  return (
    <>
      <div className={`catalog-menu-item catalog-menu-item--level-${depth}`} style={{ '--level': depth }}>
        <button className="catalog-menu-link" type="button" onClick={() => onOpen(category)}>
          <span className="catalog-menu-icon" aria-hidden="true"><LayoutGrid size={level ? 14 : 17} /></span>
          <span className="catalog-menu-copy">
            <strong>{category.displayName || category.name}</strong>
            <small>
              {category.menuDescription || (hasChildren ? `${category.children.length} разделов` : 'Открыть категорию')}
            </small>
          </span>
        </button>
        {hasChildren ? (
          <button
            className="catalog-menu-toggle"
            type="button"
            onClick={() => onToggle(category.externalId)}
            aria-label={`${isExpanded ? 'Свернуть' : 'Раскрыть'} ${category.displayName || category.name}`}
          >
            {isExpanded ? <Minus size={18} /> : <Plus size={18} />}
          </button>
        ) : (
          <span className="catalog-menu-leaf" aria-hidden="true"><ChevronRight size={18} /></span>
        )}
      </div>
      {hasChildren && isExpanded ? (
        <div className="catalog-menu-children">
          {category.children.map((child) => (
            <CatalogMenuItem
              key={child.externalId}
              category={child}
              level={level + 1}
              expanded={expanded}
              onToggle={onToggle}
              onOpen={onOpen}
            />
          ))}
        </div>
      ) : null}
    </>
  );
}

function CatalogMenuScreen({ categories, setCategoryId, setFilters, setSearch, setView, cartCount, brand }) {
  const menuCategories = useMemo(() => getCatalogMenuCategories(categories), [categories]);
  const [expanded, setExpanded] = useState(() => new Set());

  const openCategory = (category) => {
    setCategoryId(category.externalId);
    setFilters({ params: {} });
    setSearch('');
    setView('catalog');
  };

  const openAllProducts = () => {
    setCategoryId('');
    setFilters({ params: {} });
    setSearch('');
    setView('catalog');
  };

  const toggleCategory = (externalId) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(externalId)) {
        next.delete(externalId);
      } else {
        next.add(externalId);
      }
      return next;
    });
  };

  return (
    <main className="screen catalog-menu-screen">
      <AppHeader cartCount={cartCount} setView={setView} brand={brand} />
      <div className="breadcrumb">ДВ Керамик / Каталог товаров</div>
      <section className="catalog-menu-heading">
        <h1>Каталог товаров</h1>
      </section>
      <section className="catalog-menu-list" aria-label="Категории товаров">
        <button className="catalog-menu-all" type="button" onClick={openAllProducts}>
          <span className="catalog-menu-icon" aria-hidden="true"><LayoutGrid size={17} /></span>
          <span>
            <strong>Все товары</strong>
            <small>Показать весь каталог</small>
          </span>
          <ChevronRight size={18} />
        </button>
        {menuCategories.length ? menuCategories.map((category) => (
          <CatalogMenuItem
            key={category.externalId}
            category={category}
            level={0}
            expanded={expanded}
            onToggle={toggleCategory}
            onOpen={openCategory}
          />
        )) : <div className="empty">Загружаем категории...</div>}
      </section>
    </main>
  );
}

function FloatingFilterButton({ onClick, count }) {
  return (
    <button className="mobile-filter-fab" onClick={onClick} aria-label="Открыть фильтры">
      <SlidersHorizontal size={24} />
      {count ? <b>{count}</b> : null}
    </button>
  );
}

function FiltersSheet({ open, facets, filters, setFilters, onClose }) {
  const [draft, setDraft] = useState(() => cloneFilters(filters));
  const [activeGroupKey, setActiveGroupKey] = useState('all');
  const [filterSearch, setFilterSearch] = useState('');

  useEffect(() => {
    if (open) {
      setDraft(cloneFilters(filters));
      setActiveGroupKey('all');
      setFilterSearch('');
    }
  }, [open, JSON.stringify(filters)]);

  useEffect(() => {
    if (!open) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  if (!open) return null;

  const groups = getFacetGroups(facets);
  const normalizedSearch = filterSearch.trim().toLowerCase();
  const selectedItems = getSelectedFilterItems(draft, { ...facets, groups });
  const selectedCount = countSelectedFilters(draft);
  const visibleGroups = groups.filter((group) => {
    if (!normalizedSearch) return true;
    return String(group.label).toLowerCase().includes(normalizedSearch)
      || group.options?.some((option) => String(option.label).toLowerCase().includes(normalizedSearch));
  });
  const activeGroup = activeGroupKey === 'all'
    ? { key: 'all', label: 'Все фильтры', type: 'summary' }
    : (normalizedSearch
      ? visibleGroups.find((group) => group.key === activeGroupKey) || visibleGroups[0]
      : groups.find((group) => group.key === activeGroupKey)) || groups[0] || { key: 'all', label: 'Все фильтры', type: 'summary' };

  const groupSelectedCount = (group) => {
    if (group.key === 'availability') return draft.availability ? 1 : 0;
    if (group.key === 'price') return (draft.minPrice ? 1 : 0) + (draft.maxPrice ? 1 : 0);
    if (group.key?.startsWith('param:')) return (draft.params?.[group.paramName || group.key.slice(6)] || []).length;
    return 0;
  };

  const toggleParam = (name, value) => {
    const selectedParams = draft.params || {};
    const current = new Set(selectedParams[name] || []);
    if (current.has(value)) current.delete(value);
    else current.add(value);
    setDraft({ ...draft, params: { ...selectedParams, [name]: [...current] } });
  };

  const toggleGroupOption = (group, option) => {
    if (group.key === 'availability') {
      const nextValue = option.value === 'available' ? 'true' : 'false';
      setDraft({ ...draft, availability: draft.availability === nextValue ? '' : nextValue });
      return;
    }
    if (group.key?.startsWith('param:')) {
      toggleParam(group.paramName || group.key.slice(6), option.value);
    }
  };

  const reset = () => {
    setDraft({ params: {} });
  };

  const apply = () => {
    setFilters(cloneFilters(draft));
    onClose();
  };

  const removeDraftItem = (item) => {
    setDraft(removeFilterItem(draft, item));
  };

  const optionsForActiveGroup = (activeGroup.options || [])
    .filter((option) => !normalizedSearch || String(option.label).toLowerCase().includes(normalizedSearch) || String(activeGroup.label).toLowerCase().includes(normalizedSearch));

  const renderActivePanel = () => {
    if (!facets) {
      return <div className="filter-empty-state">Загружаем фильтры...</div>;
    }
    if (!groups.length) {
      return <div className="filter-empty-state">Для текущей категории нет доступных фильтров.</div>;
    }
    if (normalizedSearch && !visibleGroups.length) {
      return <div className="filter-empty-state">Ничего не найдено по запросу.</div>;
    }
    if (activeGroup.type === 'summary') {
      return selectedItems.length ? (
        <div className="dns-selected-list">
          {selectedItems.map((item) => (
            <button key={item.id} onClick={() => removeDraftItem(item)}>
              <span>
                <strong>{item.label}</strong>
                <small>{item.groupLabel}</small>
              </span>
              <X size={17} />
            </button>
          ))}
        </div>
      ) : <div className="filter-empty-state">Выберите группу слева и отметьте нужные значения.</div>;
    }
    if (activeGroup.type === 'range') {
      return (
        <div className="dns-range-panel">
          <div className="price-row">
            <input inputMode="numeric" placeholder={`от ${activeGroup.min ?? ''}`} value={draft.minPrice || ''} onChange={(event) => setDraft({ ...draft, minPrice: event.target.value })} />
            <input inputMode="numeric" placeholder={`до ${activeGroup.max ?? ''}`} value={draft.maxPrice || ''} onChange={(event) => setDraft({ ...draft, maxPrice: event.target.value })} />
          </div>
          <div className="dns-range-scale">
            <span>{activeGroup.min ? `${activeGroup.min} ₽` : 'от'}</span>
            <i />
            <span>{activeGroup.max ? `${activeGroup.max} ₽` : 'до'}</span>
          </div>
        </div>
      );
    }
    if (!optionsForActiveGroup.length) {
      return <div className="filter-empty-state">Ничего не найдено по этому фильтру.</div>;
    }
    return (
      <div className="dns-option-list">
        {optionsForActiveGroup.map((option) => {
          const selected = activeGroup.key === 'availability'
            ? (option.value === 'available' && draft.availability === 'true') || (option.value === 'on_order' && draft.availability === 'false')
            : (draft.params?.[activeGroup.paramName || activeGroup.key.slice(6)] || []).includes(option.value);
          return (
            <button key={option.value} className={selected ? 'selected' : ''} onClick={() => toggleGroupOption(activeGroup, option)}>
              <span className="dns-checkbox" />
              <span className="dns-option-label">{option.label}</span>
              <small>{option.count}</small>
            </button>
          );
        })}
      </div>
    );
  };

  return (
    <section className="dns-filter-screen" role="dialog" aria-modal="true" aria-label="Фильтры">
      <header className="dns-filter-head">
        <div>
          <h1>Фильтры</h1>
          <p>{activeGroup.key === 'all' ? 'Выберите группу слева, значение справа' : activeGroup.label}</p>
        </div>
        <div className="filters-sheet__head-actions">
          <button className="filters-reset-btn" onClick={reset}>Сбросить</button>
          <button className="filters-close-btn" onClick={onClose} aria-label="Закрыть фильтры"><X size={21} /></button>
        </div>
      </header>
      <label className="dns-filter-search">
        <Search size={17} />
        <input value={filterSearch} onChange={(event) => setFilterSearch(event.target.value)} placeholder={activeGroup.key === 'all' ? 'Поиск по фильтрам' : `Найти ${activeGroup.label.toLowerCase()}`} />
      </label>
      <div className="dns-filter-body">
        <nav className="dns-filter-groups" aria-label="Группы фильтров">
          <button className={activeGroupKey === 'all' ? 'active' : ''} onClick={() => setActiveGroupKey('all')}>
            <span>Все фильтры</span>
            {selectedCount ? <b>{selectedCount}</b> : null}
          </button>
          {visibleGroups.map((group) => {
            const count = groupSelectedCount(group);
            return (
              <button key={group.key} className={activeGroup.key === group.key ? 'active' : ''} onClick={() => setActiveGroupKey(group.key)}>
                <span>{group.label}</span>
                {count ? <b>{count}</b> : null}
              </button>
            );
          })}
          {!visibleGroups.length && normalizedSearch ? <div className="dns-group-empty">Не найдено</div> : null}
        </nav>
        <section className="dns-filter-values" aria-label={activeGroup.label}>
          {renderActivePanel()}
        </section>
      </div>
      <footer className="dns-filter-actions">
        <button className="secondary" onClick={reset}>Сбросить</button>
        <button className="primary" onClick={apply}>{selectedCount ? `Применить (${selectedCount})` : 'Применить'}</button>
      </footer>
    </section>
  );
}

function ProductGallery({ product }) {
  const images = useMemo(() => getProductImages(product), [product]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [viewerOpen, setViewerOpen] = useState(false);
  const touchStartRef = useRef(null);
  const stageSwipedRef = useRef(false);
  const thumbRefs = useRef([]);
  const activeImage = images[activeIndex];
  const hasManyImages = images.length > 1;

  useEffect(() => {
    setActiveIndex(0);
    setViewerOpen(false);
  }, [product?.id, product?.externalId, images.length]);

  useEffect(() => {
    if (activeIndex > images.length - 1) {
      setActiveIndex(Math.max(0, images.length - 1));
    }
  }, [activeIndex, images.length]);

  useEffect(() => {
    thumbRefs.current[activeIndex]?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  }, [activeIndex]);

  const goToImage = (direction) => {
    if (!images.length) return;
    setActiveIndex((current) => (current + direction + images.length) % images.length);
  };

  const handleTouchStart = (event) => {
    const touch = event.touches[0];
    touchStartRef.current = { x: touch.clientX, y: touch.clientY };
  };

  const handleTouchEnd = (event) => {
    if (!hasManyImages || !touchStartRef.current) return;
    const touch = event.changedTouches[0];
    const deltaX = touch.clientX - touchStartRef.current.x;
    const deltaY = touch.clientY - touchStartRef.current.y;
    touchStartRef.current = null;
    if (Math.abs(deltaX) < 42 || Math.abs(deltaX) < Math.abs(deltaY)) return;
    stageSwipedRef.current = true;
    window.setTimeout(() => {
      stageSwipedRef.current = false;
    }, 300);
    goToImage(deltaX < 0 ? 1 : -1);
  };

  return (
    <section className="detail-gallery" aria-label="Фотографии товара">
      <div className="detail-gallery__frame">
        <button
          type="button"
          className="detail-image detail-gallery__stage"
          onClick={() => {
            if (images.length && !stageSwipedRef.current) setViewerOpen(true);
          }}
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
          aria-label="Открыть фото на весь экран"
        >
          <ProductImage src={activeImage?.detailUrl || activeImage?.remoteUrl} fallbackSrc={activeImage?.remoteUrl} alt={product.name} loading="eager" />
        </button>
        {hasManyImages ? (
          <>
            <button className="detail-gallery__nav prev" onClick={() => goToImage(-1)} aria-label="Предыдущее фото">
              <ChevronLeft size={22} />
            </button>
            <button className="detail-gallery__nav next" onClick={() => goToImage(1)} aria-label="Следующее фото">
              <ChevronRight size={22} />
            </button>
            <span className="detail-gallery__counter">{activeIndex + 1}/{images.length}</span>
          </>
        ) : null}
      </div>
      {!hasManyImages && images.length ? <span className="detail-gallery__single-counter">1/1</span> : null}
      {hasManyImages ? (
        <div className="detail-thumbs" aria-label="Миниатюры товара">
          {images.map((image, index) => (
            <button
              key={image.id}
              ref={(node) => {
                thumbRefs.current[index] = node;
              }}
              className={index === activeIndex ? 'detail-thumb selected' : 'detail-thumb'}
              onClick={() => setActiveIndex(index)}
              aria-label={`Фото ${index + 1}`}
            >
              <ProductImage src={image.thumbUrl || image.remoteUrl} fallbackSrc={image.remoteUrl} alt={`${product.name} ${index + 1}`} />
            </button>
          ))}
        </div>
      ) : null}
      {viewerOpen ? (
        <ImageViewer
          images={images}
          activeIndex={activeIndex}
          setActiveIndex={setActiveIndex}
          onClose={() => setViewerOpen(false)}
          productName={product.name}
        />
      ) : null}
    </section>
  );
}

function ImageViewer({ images, activeIndex, setActiveIndex, onClose, productName }) {
  const touchStartRef = useRef(null);
  const activeImage = images[activeIndex];
  const hasManyImages = images.length > 1;

  const goToImage = (direction) => {
    if (!images.length) return;
    setActiveIndex((current) => (current + direction + images.length) % images.length);
  };

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onClose();
      if (event.key === 'ArrowRight') goToImage(1);
      if (event.key === 'ArrowLeft') goToImage(-1);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [images.length, onClose]);

  const handleTouchStart = (event) => {
    const touch = event.touches[0];
    touchStartRef.current = { x: touch.clientX, y: touch.clientY };
  };

  const handleTouchEnd = (event) => {
    if (!hasManyImages || !touchStartRef.current) return;
    const touch = event.changedTouches[0];
    const deltaX = touch.clientX - touchStartRef.current.x;
    const deltaY = touch.clientY - touchStartRef.current.y;
    touchStartRef.current = null;
    if (Math.abs(deltaX) < 42 || Math.abs(deltaX) < Math.abs(deltaY)) return;
    goToImage(deltaX < 0 ? 1 : -1);
  };

  if (!images.length) return null;

  return (
    <section className="image-viewer" role="dialog" aria-modal="true" aria-label="Просмотр фото">
      <header className="image-viewer__header">
        <span>{activeIndex + 1}/{images.length}</span>
        <button type="button" onClick={onClose} aria-label="Закрыть просмотр фото"><X size={24} /></button>
      </header>
      <div className="image-viewer__body" onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd}>
        {hasManyImages ? (
          <button className="image-viewer__nav prev" type="button" onClick={() => goToImage(-1)} aria-label="Предыдущее фото">
            <ChevronLeft size={28} />
          </button>
        ) : null}
        <div className="image-viewer__stage">
          <ProductImage src={activeImage?.viewerUrl || activeImage?.detailUrl || activeImage?.remoteUrl} fallbackSrc={activeImage?.remoteUrl} alt={`${productName} ${activeIndex + 1}`} loading="eager" />
        </div>
        {hasManyImages ? (
          <button className="image-viewer__nav next" type="button" onClick={() => goToImage(1)} aria-label="Следующее фото">
            <ChevronRight size={28} />
          </button>
        ) : null}
      </div>
      {hasManyImages ? (
        <div className="image-viewer__thumbs" aria-label="Миниатюры в просмотрщике">
          {images.map((image, index) => (
            <button
              key={image.id}
              type="button"
              className={index === activeIndex ? 'selected' : ''}
              onClick={() => setActiveIndex(index)}
              aria-label={`Показать фото ${index + 1}`}
            >
              <ProductImage src={image.thumbUrl || image.remoteUrl} fallbackSrc={image.remoteUrl} alt={`${productName} ${index + 1}`} />
            </button>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function ProductScreen({ product, setView, onAdd, cartCount, brand }) {
  if (!product) return null;
  const displayName = formatDisplayTitle(product.name);
  return (
    <main className="screen product-screen">
      <AppHeader cartCount={cartCount} setView={setView} brand={brand} />
      <button className="back-button" onClick={() => setView('catalog')}><ArrowLeft size={18} /> Каталог</button>
      <ProductGallery product={product} />
      <h1 className="page-title detail-title">{displayName}</h1>
      <div className="detail-meta">{getProductMeta(product) || (product.breadcrumb || []).map((item) => item.name).slice(-1)[0] || 'Каталог ДВ Керамик'}</div>
      <section className="detail-purchase">
        <div>
          <span>Цена</span>
          <UnitPriceDisplay product={product} variant="detail" />
          <small>{product.available ? 'В наличии' : 'Под заказ'} · SKU {product.sku}</small>
        </div>
        <b className={product.available ? 'detail-stock in-stock' : 'detail-stock'}>{product.available ? 'В наличии' : 'Под заказ'}</b>
      </section>
      {product.description ? <p className="detail-description">{product.description}</p> : null}
      {product.breadcrumb?.length ? <div className="breadcrumb">{product.breadcrumb.map((item) => item.name).join(' / ')}</div> : null}
      <section className="params">
        <h2>Характеристики</h2>
        {Object.entries(product.params || {}).map(([name, value]) => (
          <div key={name}><span>{name}</span><b>{Array.isArray(value) ? value.join(', ') : value}</b></div>
        ))}
      </section>
      <div className="detail-cta">
        <button className="primary full" onClick={() => onAdd(product)}>Добавить в корзину</button>
        {product.productUrl ? <a className="source-link" href={product.productUrl} target="_blank" rel="noreferrer">Открыть на сайте</a> : null}
      </div>
    </main>
  );
}

function CartScreen({ cart, setCart, setView, cartCount, brand }) {
  const items = getCartItems(cart);
  return (
    <main className="screen">
      <AppHeader cartCount={cartCount} setView={setView} brand={brand} />
      <h1 className="page-title">Корзина</h1>
      {!items.length ? <div className="empty">Корзина пока пустая</div> : null}
      <div className="cart-list">
        {items.map((item) => (
          <div className="cart-item" key={item.productExternalId}>
            <div className="cart-item__image"><ProductImage src={item.imageUrl} fallbackSrc={item.remoteImageUrl} alt={item.name} /></div>
            <div>
              <strong>{formatDisplayTitle(item.name)}</strong>
              <span>{formatPrice(item.price, item.currencyId)}</span>
              <div className="qty">
                <button onClick={() => setCart(updateQuantity(cart, item.productExternalId, item.quantity - 1))}>−</button>
                <b>{item.quantity}</b>
                <button onClick={() => setCart(updateQuantity(cart, item.productExternalId, item.quantity + 1))}>+</button>
              </div>
            </div>
          </div>
        ))}
      </div>
      {items.length ? (
        <div className="checkout-panel">
          <div><span>Предварительно</span><strong>{formatPrice(getCartTotal(cart), 'RUB')}</strong></div>
          <button className="primary full" onClick={() => setView('checkout')}>Оформить заявку</button>
        </div>
      ) : null}
    </main>
  );
}

function CheckoutScreen({ cart, platform, setCart, setView, cartCount, brand }) {
  const [form, setForm] = useState({ name: platform.user?.firstName || '', phone: '', deliveryMethod: 'pickup', comment: '' });
  const [status, setStatus] = useState('');
  const items = getCartItems(cart);

  const submit = async (event) => {
    event.preventDefault();
    setStatus('Отправляем заявку...');
    try {
      await apiPost('/api/orders', {
        customerName: form.name,
        phone: form.phone,
        deliveryMethod: form.deliveryMethod,
        comment: form.comment,
        items: items.map((item) => ({ productExternalId: item.productExternalId, quantity: item.quantity }))
      }, platform);
      clearCart();
      setCart({});
      setStatus('Заявка сохранена. Менеджер свяжется с вами.');
      setTimeout(() => setView('orders'), 800);
    } catch (error) {
      setStatus(error.message);
    }
  };

  return (
    <main className="screen">
      <AppHeader cartCount={cartCount} setView={setView} brand={brand} />
      <button className="back-button" onClick={() => setView('cart')}><ArrowLeft size={18} /> Корзина</button>
      <h1 className="page-title">Заявка менеджеру</h1>
      <form className="checkout-form" onSubmit={submit}>
        <input required placeholder="Имя" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
        <input required inputMode="tel" placeholder="Телефон" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} />
        <select value={form.deliveryMethod} onChange={(event) => setForm({ ...form, deliveryMethod: event.target.value })}>
          <option value="pickup">Самовывоз</option>
          <option value="delivery">Доставка</option>
        </select>
        <textarea placeholder="Комментарий" value={form.comment} onChange={(event) => setForm({ ...form, comment: event.target.value })} />
        <button className="primary full" type="submit">Отправить заявку</button>
      </form>
      {status ? <div className="status-line">{status}</div> : null}
    </main>
  );
}

function AdminEntry({ setView }) {
  return (
    <section className="admin-entry">
      <div>
        <strong>Админ-панель</strong>
        <span>Настройки, посетители, заявки и импорт</span>
      </div>
      <button className="secondary" onClick={() => setView('admin')}>Открыть</button>
    </section>
  );
}

function OrdersScreen({ platform, me, setView, cartCount, brand }) {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    apiGet('/api/orders', {}, platform).then((data) => setOrders(data.orders || [])).catch(() => setOrders([])).finally(() => setLoading(false));
  }, []);

  return (
    <main className="screen">
      <AppHeader cartCount={cartCount} setView={setView} brand={brand} />
      {me?.isAdmin ? <AdminEntry setView={setView} /> : null}
      <h1 className="page-title">Заявки</h1>
      {loading ? <div className="empty">Загружаем...</div> : null}
      {!loading && !orders.length ? <div className="empty">Здесь появятся ваши последние заявки</div> : null}
      <div className="orders-list">
        {orders.map((order) => (
          <article className="order-card" key={order.id}>
            <strong>Заявка #{order.id.slice(0, 8)}</strong>
            <span>{new Date(order.createdAt).toLocaleString('ru-RU')}</span>
            <b>{formatOrderStatus(order.status)}</b>
            <p>{order.items.map((item) => `${item.productName} x${item.quantity}`).join(', ')}</p>
          </article>
        ))}
      </div>
    </main>
  );
}

function AdminGuard({ me, setView, children }) {
  if (!me) {
    return <main className="screen"><div className="empty">Проверяем доступ...</div></main>;
  }
  if (!me.isAdmin) {
    return (
      <main className="screen">
        <button className="back-button" onClick={() => setView('orders')}><ArrowLeft size={18} /> Назад</button>
        <h1 className="page-title">Админ-панель</h1>
        <div className="empty">Для этого пользователя доступ администратора закрыт.</div>
      </main>
    );
  }
  return children;
}

function AdminMenu({ setView }) {
  const items = [
    ['adminSettings', 'Настройки', 'Логотип, фид, публичная ссылка и импорт'],
    ['adminVisitors', 'Посетители', 'Последние открытия Mini App'],
    ['adminOrders', 'Заявки', 'Все отправленные обращения']
  ];
  return (
    <main className="screen">
      <button className="back-button" onClick={() => setView('orders')}><ArrowLeft size={18} /> Заявки</button>
      <h1 className="page-title">Админ-панель</h1>
      <div className="admin-grid">
        {items.map(([view, title, description]) => (
          <button key={view} className="admin-card" onClick={() => setView(view)}>
            <strong>{title}</strong>
            <span>{description}</span>
          </button>
        ))}
      </div>
    </main>
  );
}

function AdminSettingsScreen({ platform, setView, onBrandChange }) {
  const [settings, setSettings] = useState(null);
  const [brandForm, setBrandForm] = useState(DEFAULT_BRAND);
  const [status, setStatus] = useState('');
  const [brandStatus, setBrandStatus] = useState('');
  const [savingBrand, setSavingBrand] = useState(false);

  const load = () => {
    setStatus('');
    apiGet('/api/admin/settings', {}, platform)
      .then((data) => {
        const nextSettings = data.settings;
        const nextBrand = { ...DEFAULT_BRAND, ...(nextSettings?.brand || {}) };
        setSettings(nextSettings);
        setBrandForm(nextBrand);
        onBrandChange?.(nextBrand);
      })
      .catch((error) => setStatus(error.message));
  };

  useEffect(load, []);

  const saveBrand = async () => {
    setSavingBrand(true);
    setBrandStatus('Сохраняем бренд...');
    try {
      const data = await apiPost('/api/admin/settings/brand', { brand: brandForm }, platform);
      const nextBrand = { ...DEFAULT_BRAND, ...(data.brand || {}) };
      setBrandForm(nextBrand);
      setSettings((current) => ({ ...(current || {}), brand: nextBrand }));
      onBrandChange?.(nextBrand);
      setBrandStatus('Бренд сохранен.');
    } catch (error) {
      setBrandStatus(error.message);
    } finally {
      setSavingBrand(false);
    }
  };

  const runImport = async () => {
    setStatus('Запускаем импорт...');
    try {
      const data = await apiPost('/api/admin/import/run', {}, platform);
      setStatus(`Импорт завершен: категорий ${data.import.categoriesTotal}, товаров ${data.import.offersTotal}.`);
      load();
    } catch (error) {
      setStatus(error.message);
    }
  };

  return (
    <main className="screen">
      <button className="back-button" onClick={() => setView('admin')}><ArrowLeft size={18} /> Админка</button>
      <h1 className="page-title">Настройки</h1>
      {!settings ? <div className="empty">Загружаем настройки...</div> : (
        <>
          <section className="admin-settings-card">
            <h2>Бренд и логотип</h2>
            <div className="brand-preview">
              <BrandMark brand={brandForm} />
              <span>
                <strong>{brandForm.title || DEFAULT_BRAND.title}</strong>
                <small>{brandForm.subtitle || DEFAULT_BRAND.subtitle}</small>
              </span>
            </div>
            <label>
              <span>Название</span>
              <input value={brandForm.title} maxLength={80} onChange={(event) => setBrandForm({ ...brandForm, title: event.target.value })} />
            </label>
            <label>
              <span>Подпись</span>
              <input value={brandForm.subtitle} maxLength={120} onChange={(event) => setBrandForm({ ...brandForm, subtitle: event.target.value })} />
            </label>
            <label>
              <span>URL логотипа</span>
              <input inputMode="url" placeholder="https://..." value={brandForm.logoUrl} onChange={(event) => setBrandForm({ ...brandForm, logoUrl: event.target.value })} />
            </label>
            <p>Используйте прямую ссылку на изображение в формате PNG, JPG, SVG или WebP. Если поле пустое, будет показан знак “ДК”.</p>
            <button className="primary full" type="button" onClick={saveBrand} disabled={savingBrand}>{savingBrand ? 'Сохраняем...' : 'Сохранить бренд'}</button>
            {brandStatus ? <div className="status-line">{brandStatus}</div> : null}
          </section>

          <section className="admin-details">
            <div><span>YML-фид</span><b>{settings.feedUrl}</b></div>
            <div><span>Публичная ссылка Mini App</span><b>{settings.miniappPublicUrl || 'не настроена'}</b></div>
            <div><span>Уведомления в Telegram</span><b>{settings.telegramNotificationsConfigured ? 'настроены' : 'не настроены'}</b></div>
            <div><span>Последний статус импорта</span><b>{settings.latestImport?.status || 'нет данных'}</b></div>
            <div><span>Время последнего импорта</span><b>{formatDateTime(settings.latestImport?.finished_at || settings.latestImport?.finishedAt)}</b></div>
            <div><span>Категорий импортировано</span><b>{settings.latestImport?.categories_total ?? settings.counts?.active_categories ?? 0}</b></div>
            <div><span>Товаров импортировано</span><b>{settings.latestImport?.offers_total ?? settings.counts?.active_products ?? 0}</b></div>
            <div><span>Скрытых товаров</span><b>{settings.latestImport?.products_hidden ?? settings.counts?.hidden_products ?? 0}</b></div>
            <div><span>Посетителей</span><b>{settings.counts?.visitors_total ?? 0}</b></div>
            <div><span>Заявок</span><b>{settings.counts?.orders_total ?? 0}</b></div>
          </section>
        </>
      )}
      <button className="primary full" onClick={runImport}>Запустить импорт сейчас</button>
      {status ? <div className="status-line">{status}</div> : null}
    </main>
  );
}

function AdminVisitorsScreen({ platform, setView }) {
  const [data, setData] = useState(null);
  const [status, setStatus] = useState('');
  useEffect(() => {
    apiGet('/api/admin/visitors', { limit: 50 }, platform)
      .then(setData)
      .catch((error) => setStatus(error.message));
  }, []);

  return (
    <main className="screen">
      <button className="back-button" onClick={() => setView('admin')}><ArrowLeft size={18} /> Админка</button>
      <h1 className="page-title">Посетители</h1>
      {status ? <div className="status-line">{status}</div> : null}
      {!data ? <div className="empty">Загружаем посетителей...</div> : null}
      {data && !data.visitors.length ? <div className="empty">Посетителей пока нет.</div> : null}
      <div className="admin-list">
        {(data?.visitors || []).map((visitor) => (
          <article className="admin-card static" key={visitor.id}>
            <strong>{visitor.username ? `@${visitor.username}` : visitor.firstName || visitor.telegramUserId || 'Анонимный посетитель'}</strong>
            <span>ID: {visitor.telegramUserId || 'анонимно'} · {visitor.source}</span>
            <span>Открытий: {visitor.visitsCount} · Заявок: {visitor.ordersCount}</span>
            <span>Первый визит: {formatDateTime(visitor.firstSeenAt)}</span>
            <span>Последний визит: {formatDateTime(visitor.lastSeenAt)}</span>
          </article>
        ))}
      </div>
    </main>
  );
}

function AdminOrdersScreen({ platform, setView }) {
  const [data, setData] = useState(null);
  const [status, setStatus] = useState('');
  useEffect(() => {
    apiGet('/api/admin/orders', { limit: 50 }, platform)
      .then(setData)
      .catch((error) => setStatus(error.message));
  }, []);

  return (
    <main className="screen">
      <button className="back-button" onClick={() => setView('admin')}><ArrowLeft size={18} /> Админка</button>
      <h1 className="page-title">Заявки</h1>
      {status ? <div className="status-line">{status}</div> : null}
      {!data ? <div className="empty">Загружаем заявки...</div> : null}
      {data && !data.orders.length ? <div className="empty">Заявок пока нет.</div> : null}
      <div className="admin-list">
        {(data?.orders || []).map((order) => (
          <article className="order-card" key={order.id}>
            <strong>Заявка #{order.id.slice(0, 8)}</strong>
            <span>{formatDateTime(order.createdAt)} · {formatOrderStatus(order.status)}</span>
            <span>{order.customerName} · {order.phone}</span>
            <span>Telegram: {order.username ? `@${order.username}` : order.telegramUserId || 'не указан'}</span>
            <span>Итого: {formatPrice(order.totalPrice, 'RUB')}</span>
            {order.comment ? <p>{order.comment}</p> : null}
            <p>{order.items.map((item) => `${item.productName} / ${item.sku} x${item.quantity}`).join(', ')}</p>
          </article>
        ))}
      </div>
    </main>
  );
}

function App() {
  const [view, setView] = useState(initialViewFromPath());
  const [categories, setCategories] = useState([]);
  const [products, setProducts] = useState([]);
  const [facets, setFacets] = useState(null);
  const [pagination, setPagination] = useState(null);
  const [categoryId, setCategoryId] = useState('');
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState({ params: {} });
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState('');
  const [sort, setSort] = useState('default');
  const [catalogViewMode, setCatalogViewMode] = useState(loadCatalogViewMode);
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [cart, setCart] = useState(loadCart());
  const [me, setMe] = useState(null);
  const [brand, setBrand] = useState(DEFAULT_BRAND);
  const [homeBanners, setHomeBanners] = useState([]);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const catalogRequestRef = useRef(0);
  const filtersOpenRef = useRef(false);

  const categoriesFlat = useMemo(() => flattenCategories(categories), [categories]);
  const filtersKey = useMemo(() => JSON.stringify(filters), [filters]);
  const debouncedSearch = useDebouncedValue(search.trim(), 300);

  useEffect(() => {
    platform.ready();
    apiGet('/api/catalog/categories').then((data) => setCategories(data.categories || []));
    apiGet('/api/app/settings').then((data) => {
      setBrand({ ...DEFAULT_BRAND, ...(data.settings?.brand || {}) });
      setHomeBanners(data.settings?.homeBanners || []);
    }).catch(() => {});
    apiGet('/api/me', {}, platform).then(setMe).catch(() => setMe({ user: null, isAdmin: false }));
    apiPost('/api/visits', { source: platform.name }, platform).catch(() => {});
  }, []);

  useEffect(() => {
    saveCart(cart);
  }, [cart]);

  useEffect(() => {
    try {
      window.localStorage.setItem(CATALOG_VIEW_MODE_KEY, catalogViewMode);
    } catch {
      // localStorage can be unavailable in restricted webviews.
    }
  }, [catalogViewMode]);

  useEffect(() => {
    filtersOpenRef.current = filtersOpen;
  }, [filtersOpen]);

  useEffect(() => {
    const onPopState = () => {
      if (filtersOpenRef.current) setFiltersOpen(false);
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  useEffect(() => {
    window.scrollTo(0, 0);
    if (view !== 'catalog') setFiltersOpen(false);
  }, [view]);

  useEffect(() => {
    const requestId = catalogRequestRef.current + 1;
    catalogRequestRef.current = requestId;
    const currentFilters = cloneFilters(filters);
    setLoading(true);
    setLoadingMore(false);
    setLoadMoreError('');
    const query = { categoryId, search: debouncedSearch, filters: currentFilters, page: 1, limit: CATALOG_PAGE_LIMIT, sort };
    Promise.all([
      apiGet('/api/catalog/products', query),
      apiGet('/api/catalog/facets', { categoryId, search: debouncedSearch, filters: currentFilters })
    ]).then(([productData, facetData]) => {
      if (catalogRequestRef.current !== requestId) return;
      setProducts(productData.products || []);
      setPagination(productData.pagination);
      setFacets(facetData.facets);
    }).catch(() => {
      if (catalogRequestRef.current !== requestId) return;
      setProducts([]);
      setPagination(null);
      setFacets(null);
    }).finally(() => {
      if (catalogRequestRef.current === requestId) setLoading(false);
    });
  }, [categoryId, debouncedSearch, filtersKey, sort]);

  const loadMoreProducts = async () => {
    if (loading || loadingMore || !(pagination?.hasMore || pagination?.hasNextPage)) return;
    const requestId = catalogRequestRef.current;
    const nextPage = pagination.nextPage || (Number(pagination.page) || 1) + 1;
    const currentFilters = cloneFilters(filters);
    setLoadingMore(true);
    setLoadMoreError('');
    try {
      const productData = await apiGet('/api/catalog/products', {
        categoryId,
        search: debouncedSearch,
        filters: currentFilters,
        page: nextPage,
        limit: pagination.limit || CATALOG_PAGE_LIMIT,
        sort
      });
      if (catalogRequestRef.current !== requestId) return;
      setProducts((currentProducts) => {
        const seen = new Set(currentProducts.map((product) => product.id || product.externalId || product.sku));
        const additions = (productData.products || []).filter((product) => {
          const key = product.id || product.externalId || product.sku;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
        return [...currentProducts, ...additions];
      });
      setPagination(productData.pagination || null);
    } catch {
      if (catalogRequestRef.current === requestId) {
        setLoadMoreError('Не удалось загрузить следующую страницу');
      }
    } finally {
      setLoadingMore(false);
    }
  };

  const openProduct = async (product) => {
    const detail = await apiGet(`/api/catalog/products/${encodeURIComponent(product.externalId)}`);
    setSelectedProduct(detail.product);
    setView('product');
  };

  const onAdd = (product) => {
    setCart(addToCart(cart, product));
  };

  const cartCount = getCartItems(cart).reduce((sum, item) => sum + item.quantity, 0);
  const showOrdersNav = platform.name === 'telegram' && Boolean(me?.isAdmin);
  const selectedFiltersCount = countSelectedFilters(filters);
  const openFilters = () => {
    if (!filtersOpenRef.current) {
      window.history.pushState({ dvkFilters: true }, '', window.location.href);
    }
    setFiltersOpen(true);
  };
  const closeFilters = () => {
    if (window.history.state?.dvkFilters) {
      window.history.back();
    } else {
      setFiltersOpen(false);
    }
  };

  return (
    <div className="app-shell">
      {view === 'home' && <HomeScreen categories={categories} facets={facets} products={products} search={search} setSearch={setSearch} setCategoryId={setCategoryId} setFilters={setFilters} setView={setView} onOpen={openProduct} cartCount={cartCount} brand={brand} homeBanners={homeBanners} loading={loading} />}
      {view === 'catalogMenu' && <CatalogMenuScreen categories={categories} setCategoryId={setCategoryId} setFilters={setFilters} setSearch={setSearch} setView={setView} cartCount={cartCount} brand={brand} />}
      {view === 'catalog' && <CatalogScreen categoriesFlat={categoriesFlat} categoryId={categoryId} setCategoryId={setCategoryId} products={products} pagination={pagination} facets={facets} filters={filters} setFilters={setFilters} search={search} setSearch={setSearch} setView={setView} onOpen={openProduct} onAdd={onAdd} onOpenFilters={openFilters} onLoadMore={loadMoreProducts} loading={loading} loadingMore={loadingMore} loadError={loadMoreError} cartCount={cartCount} sort={sort} setSort={setSort} viewMode={catalogViewMode} setViewMode={setCatalogViewMode} brand={brand} />}
      {view === 'product' && <ProductScreen product={selectedProduct} setView={setView} onAdd={onAdd} cartCount={cartCount} brand={brand} />}
      {view === 'cart' && <CartScreen cart={cart} setCart={setCart} setView={setView} cartCount={cartCount} brand={brand} />}
      {view === 'checkout' && <CheckoutScreen cart={cart} platform={platform} setCart={setCart} setView={setView} cartCount={cartCount} brand={brand} />}
      {view === 'orders' && <OrdersScreen platform={platform} me={me} setView={setView} cartCount={cartCount} brand={brand} />}
      {view === 'admin' && <AdminGuard me={me} setView={setView}><AdminMenu setView={setView} /></AdminGuard>}
      {view === 'adminSettings' && <AdminGuard me={me} setView={setView}><AdminSettingsScreen platform={platform} setView={setView} onBrandChange={setBrand} /></AdminGuard>}
      {view === 'adminVisitors' && <AdminGuard me={me} setView={setView}><AdminVisitorsScreen platform={platform} setView={setView} /></AdminGuard>}
      {view === 'adminOrders' && <AdminGuard me={me} setView={setView}><AdminOrdersScreen platform={platform} setView={setView} /></AdminGuard>}
      {view === 'catalog' ? <FloatingFilterButton onClick={openFilters} count={selectedFiltersCount} /> : null}
      <FiltersSheet open={filtersOpen} facets={facets} filters={filters} setFilters={setFilters} onClose={closeFilters} />
      <BottomNav view={view} setView={setView} cartCount={cartCount} showOrders={showOrdersNav} />
    </div>
  );
}

createRoot(document.getElementById('root')).render(<App />);
