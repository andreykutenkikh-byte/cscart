import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Home, LayoutGrid, ShoppingCart, ClipboardList, Search, SlidersHorizontal, ChevronLeft, ChevronRight, ArrowLeft, X, Plus, Minus } from 'lucide-react';
import { apiGet, apiPost } from './api.js';
import { addToCart, clearCart, getCartItems, getCartTotal, loadCart, saveCart, updateQuantity } from './cart.js';
import { getPlatform } from './platform/index.js';
import './styles.css';

const platform = getPlatform();

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
  const formatted = formatPrice(product.price, product.currencyId);
  if (formatted === 'Цена по запросу') return formatted;
  return hasSquareMeterFactor(product) ? `${formatted}/м²` : formatted;
}

function hasSquareMeterFactor(product) {
  return Object.entries(product?.params || {}).some(([name, rawValue]) => {
    const normalizedName = String(name).toLowerCase().replace(/\s+/g, ' ');
    const value = Array.isArray(rawValue) ? rawValue.join(' ') : rawValue;
    const normalizedValue = String(value ?? '').trim();
    const isSquareMeterFactor = normalizedName.includes('штук')
      && (
        normalizedName.includes('кв.м')
        || normalizedName.includes('кв м')
        || normalizedName.includes('м²')
        || normalizedName.includes('м2')
      );
    return isSquareMeterFactor && normalizedValue && normalizedValue !== '0';
  });
}

function getProductImages(product) {
  const urls = [
    ...(product?.images || []).map((image) => image.remoteUrl || image.remote_url || image.url),
    product?.remoteImageUrl,
    product?.imageUrl
  ].filter(Boolean);
  const uniqueUrls = [...new Set(urls)];
  return uniqueUrls.map((remoteUrl, index) => ({ id: `${remoteUrl}-${index}`, remoteUrl }));
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
  if (!value) return 'not available';
  return new Date(value).toLocaleString('ru-RU');
}

function ProductImage({ src, alt }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  if (!src || failed) return <div className="image-fallback">DV</div>;
  return <img src={src} alt={alt} loading="lazy" onError={() => setFailed(true)} />;
}

function AppHeader({ cartCount = 0, setView }) {
  return (
    <header className="app-header">
      <button className="brand-lockup" onClick={() => setView('home')} aria-label="На главную">
        <span className="brand-mark">ДК</span>
        <span>
          <strong>ДВ Керамик</strong>
          <small>каталог обновляется ежедневно</small>
        </span>
      </button>
      <button className="header-action" onClick={() => setView('cart')} aria-label="Открыть корзину">
        <ShoppingCart size={18} />
        {cartCount > 0 ? <b>{cartCount}</b> : null}
      </button>
    </header>
  );
}

function ProductCard({ product, onOpen, onAdd }) {
  if (!product) return null;
  return (
    <article className="product-card" onClick={() => onOpen(product)}>
      <div className="product-card__image">
        <ProductImage src={product.remoteImageUrl || product.imageUrl} alt={product.name} />
        <span className={product.available ? 'product-tag stock' : 'product-tag'}>{product.available ? 'склад' : 'заказ'}</span>
      </div>
      <div className="product-card__body">
        <div className="product-card__name">{product.name}</div>
        <div className="product-card__meta">{getProductMeta(product)}</div>
        <div className="product-card__bottom">
          <strong>{formatProductPrice(product)}</strong>
          <button className="icon-button" onClick={(event) => { event.stopPropagation(); onAdd(product); }}>+</button>
        </div>
      </div>
    </article>
  );
}

function BottomNav({ view, setView, cartCount }) {
  const items = [
    ['home', 'Главная', Home],
    ['catalogMenu', 'Каталог', LayoutGrid],
    ['cart', 'Корзина', ShoppingCart],
    ['orders', 'Заявки', ClipboardList]
  ];
  return (
    <nav className="bottom-nav">
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

function HomeScreen({ categories, facets, products, search, setSearch, setCategoryId, setFilters, setView, onOpen, onAdd, cartCount }) {
  const categoryCards = getCategoryCards(categories, facets).slice(0, 4);
  const quickFacets = getQuickFacets(facets).slice(0, 4);
  const visibleProducts = products.filter(Boolean);
  const featuredProduct = visibleProducts.find((product) => product.remoteImageUrl || product.imageUrl) || visibleProducts[0];

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
      <AppHeader cartCount={cartCount} setView={setView} />
      <label className="search-box">
        <Search size={18} />
        <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Найти плитку, коллекцию, размер..." />
      </label>
      <section className="hero">
        <div>
          <h1>Каталог плитки с актуальными остатками</h1>
          <p>Категории и фильтры собираются из файла импорта.</p>
          <button onClick={() => setView('catalogMenu')}>В каталог</button>
        </div>
        <div className="hero__media">
          <ProductImage src={featuredProduct?.remoteImageUrl || featuredProduct?.imageUrl} alt={featuredProduct?.name || 'Плитка'} />
        </div>
      </section>
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
          {visibleProducts.slice(0, 6).map((product) => <ProductCard key={product.externalId} product={product} onOpen={onOpen} onAdd={onAdd} />)}
        </div>
      </section>
    </main>
  );
}

function CatalogScreen({ categoriesFlat, categoryId, setCategoryId, products, pagination, facets, filters, setFilters, search, setSearch, setView, onOpen, onAdd, loading, cartCount }) {
  const selectedCategory = categoriesFlat.find((category) => category.externalId === categoryId);
  const categoryChips = (facets?.category || []).slice(0, 10);
  const selectedFilterItems = getSelectedFilterItems(filters, facets);
  const visibleProducts = products.filter(Boolean);

  return (
    <main className="screen">
      <AppHeader cartCount={cartCount} setView={setView} />
      <div className="toolbar">
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
      <div className="result-row">
        <h1>{selectedCategory?.name || 'Товары по фильтру'}</h1>
        <span>{pagination?.total ?? products.length} позиций</span>
      </div>
      {loading ? <div className="empty">Загружаем каталог...</div> : null}
      {!loading && !visibleProducts.length ? <div className="empty">Ничего не найдено</div> : null}
      <div className="product-list">
        {visibleProducts.map((product) => <ProductCard key={product.externalId} product={product} onOpen={onOpen} onAdd={onAdd} />)}
      </div>
      {pagination?.hasNextPage ? <div className="empty">Показана первая страница. Уточните поиск или фильтры.</div> : null}
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

function CatalogMenuScreen({ categories, setCategoryId, setFilters, setSearch, setView, cartCount }) {
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
      <AppHeader cartCount={cartCount} setView={setView} />
      <div className="breadcrumb">ДВ Керамик / Каталог товаров</div>
      <section className="catalog-menu-heading">
        <h1>Каталог товаров</h1>
        <p>Разделы сгруппированы по структуре основного сайта.</p>
      </section>
      <button className="catalog-menu-all" type="button" onClick={openAllProducts}>
        <span className="catalog-menu-icon" aria-hidden="true"><LayoutGrid size={17} /></span>
        <span>
          <strong>Все товары</strong>
          <small>Показать весь импортированный каталог</small>
        </span>
        <ChevronRight size={18} />
      </button>
      <section className="catalog-menu-list" aria-label="Категории товаров">
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
          <ProductImage src={activeImage?.remoteUrl} alt={product.name} />
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
              <ProductImage src={image.remoteUrl} alt={`${product.name} ${index + 1}`} />
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
          <ProductImage src={activeImage?.remoteUrl} alt={`${productName} ${activeIndex + 1}`} />
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
              <ProductImage src={image.remoteUrl} alt={`${productName} ${index + 1}`} />
            </button>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function ProductScreen({ product, setView, onAdd, cartCount }) {
  if (!product) return null;
  return (
    <main className="screen">
      <AppHeader cartCount={cartCount} setView={setView} />
      <button className="back-button" onClick={() => setView('catalog')}><ArrowLeft size={18} /> Каталог</button>
      <ProductGallery product={product} />
      <h1 className="page-title">{product.name}</h1>
      <div className="detail-price">{formatProductPrice(product)}</div>
      <div className="detail-meta">{product.available ? 'В наличии' : 'Под заказ'} · SKU {product.sku}</div>
      {product.description ? <p className="detail-description">{product.description}</p> : null}
      {product.breadcrumb?.length ? <div className="breadcrumb">{product.breadcrumb.map((item) => item.name).join(' / ')}</div> : null}
      <section className="params">
        {Object.entries(product.params || {}).map(([name, value]) => (
          <div key={name}><span>{name}</span><b>{Array.isArray(value) ? value.join(', ') : value}</b></div>
        ))}
      </section>
      <button className="primary full" onClick={() => onAdd(product)}>Добавить в корзину</button>
      {product.productUrl ? <a className="source-link" href={product.productUrl} target="_blank" rel="noreferrer">Открыть на сайте</a> : null}
    </main>
  );
}

function CartScreen({ cart, setCart, setView, cartCount }) {
  const items = getCartItems(cart);
  return (
    <main className="screen">
      <AppHeader cartCount={cartCount} setView={setView} />
      <h1 className="page-title">Корзина</h1>
      {!items.length ? <div className="empty">Корзина пока пустая</div> : null}
      <div className="cart-list">
        {items.map((item) => (
          <div className="cart-item" key={item.productExternalId}>
            <div className="cart-item__image"><ProductImage src={item.imageUrl} alt={item.name} /></div>
            <div>
              <strong>{item.name}</strong>
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

function CheckoutScreen({ cart, platform, setCart, setView, cartCount }) {
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
      <AppHeader cartCount={cartCount} setView={setView} />
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
        <strong>Admin Panel</strong>
        <span>Settings, Visitors, Orders, Import status</span>
      </div>
      <button className="secondary" onClick={() => setView('admin')}>Open</button>
    </section>
  );
}

function OrdersScreen({ platform, me, setView, cartCount }) {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    apiGet('/api/orders', {}, platform).then((data) => setOrders(data.orders || [])).catch(() => setOrders([])).finally(() => setLoading(false));
  }, []);

  return (
    <main className="screen">
      <AppHeader cartCount={cartCount} setView={setView} />
      {me?.isAdmin ? <AdminEntry setView={setView} /> : null}
      <h1 className="page-title">Заявки</h1>
      {loading ? <div className="empty">Загружаем...</div> : null}
      {!loading && !orders.length ? <div className="empty">Здесь появятся ваши последние заявки</div> : null}
      <div className="orders-list">
        {orders.map((order) => (
          <article className="order-card" key={order.id}>
            <strong>Заявка #{order.id.slice(0, 8)}</strong>
            <span>{new Date(order.createdAt).toLocaleString('ru-RU')}</span>
            <b>{order.status}</b>
            <p>{order.items.map((item) => `${item.productName} x${item.quantity}`).join(', ')}</p>
          </article>
        ))}
      </div>
    </main>
  );
}

function AdminGuard({ me, setView, children }) {
  if (!me) {
    return <main className="screen"><div className="empty">Checking access...</div></main>;
  }
  if (!me.isAdmin) {
    return (
      <main className="screen">
        <button className="back-button" onClick={() => setView('orders')}><ArrowLeft size={18} /> Back</button>
        <h1 className="page-title">Admin Panel</h1>
        <div className="empty">Admin access is not available for this user.</div>
      </main>
    );
  }
  return children;
}

function AdminMenu({ setView }) {
  const items = [
    ['adminSettings', 'Settings', 'Feed, public URL, import status'],
    ['adminVisitors', 'Visitors', 'Recent Mini App visitors'],
    ['adminOrders', 'Orders', 'All submitted requests']
  ];
  return (
    <main className="screen">
      <button className="back-button" onClick={() => setView('orders')}><ArrowLeft size={18} /> Orders</button>
      <h1 className="page-title">Admin Panel</h1>
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

function AdminSettingsScreen({ platform, setView }) {
  const [settings, setSettings] = useState(null);
  const [status, setStatus] = useState('');

  const load = () => {
    setStatus('');
    apiGet('/api/admin/settings', {}, platform)
      .then((data) => setSettings(data.settings))
      .catch((error) => setStatus(error.message));
  };

  useEffect(load, []);

  const runImport = async () => {
    setStatus('Running import...');
    try {
      const data = await apiPost('/api/admin/import/run', {}, platform);
      setStatus(`Import completed: ${data.import.categoriesTotal} categories, ${data.import.offersTotal} products.`);
      load();
    } catch (error) {
      setStatus(error.message);
    }
  };

  return (
    <main className="screen">
      <button className="back-button" onClick={() => setView('admin')}><ArrowLeft size={18} /> Admin</button>
      <h1 className="page-title">Settings</h1>
      {!settings ? <div className="empty">Loading settings...</div> : (
        <section className="admin-details">
          <div><span>Feed URL</span><b>{settings.feedUrl}</b></div>
          <div><span>Mini App URL</span><b>{settings.miniappPublicUrl || 'not configured'}</b></div>
          <div><span>Telegram notifications</span><b>{settings.telegramNotificationsConfigured ? 'configured' : 'not configured'}</b></div>
          <div><span>Last import status</span><b>{settings.latestImport?.status || 'not available'}</b></div>
          <div><span>Last import time</span><b>{formatDateTime(settings.latestImport?.finished_at || settings.latestImport?.finishedAt)}</b></div>
          <div><span>Imported categories</span><b>{settings.latestImport?.categories_total ?? settings.counts?.active_categories ?? 0}</b></div>
          <div><span>Imported products</span><b>{settings.latestImport?.offers_total ?? settings.counts?.active_products ?? 0}</b></div>
          <div><span>Hidden products</span><b>{settings.latestImport?.products_hidden ?? settings.counts?.hidden_products ?? 0}</b></div>
          <div><span>Visitors</span><b>{settings.counts?.visitors_total ?? 0}</b></div>
          <div><span>Orders</span><b>{settings.counts?.orders_total ?? 0}</b></div>
        </section>
      )}
      <button className="primary full" onClick={runImport}>Run import now</button>
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
      <button className="back-button" onClick={() => setView('admin')}><ArrowLeft size={18} /> Admin</button>
      <h1 className="page-title">Visitors</h1>
      {status ? <div className="status-line">{status}</div> : null}
      {!data ? <div className="empty">Loading visitors...</div> : null}
      {data && !data.visitors.length ? <div className="empty">No visitors yet.</div> : null}
      <div className="admin-list">
        {(data?.visitors || []).map((visitor) => (
          <article className="admin-card static" key={visitor.id}>
            <strong>{visitor.username ? `@${visitor.username}` : visitor.firstName || visitor.telegramUserId || 'Anonymous visitor'}</strong>
            <span>ID: {visitor.telegramUserId || 'anonymous'} · {visitor.source}</span>
            <span>Visits: {visitor.visitsCount} · Orders: {visitor.ordersCount}</span>
            <span>First seen: {formatDateTime(visitor.firstSeenAt)}</span>
            <span>Last seen: {formatDateTime(visitor.lastSeenAt)}</span>
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
      <button className="back-button" onClick={() => setView('admin')}><ArrowLeft size={18} /> Admin</button>
      <h1 className="page-title">Orders</h1>
      {status ? <div className="status-line">{status}</div> : null}
      {!data ? <div className="empty">Loading orders...</div> : null}
      {data && !data.orders.length ? <div className="empty">No orders yet.</div> : null}
      <div className="admin-list">
        {(data?.orders || []).map((order) => (
          <article className="order-card" key={order.id}>
            <strong>Order #{order.id.slice(0, 8)}</strong>
            <span>{formatDateTime(order.createdAt)} · {order.status}</span>
            <span>{order.customerName} · {order.phone}</span>
            <span>Telegram: {order.username ? `@${order.username}` : order.telegramUserId || 'not provided'}</span>
            <span>Total: {formatPrice(order.totalPrice, 'RUB')}</span>
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
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [cart, setCart] = useState(loadCart());
  const [me, setMe] = useState(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const catalogRequestRef = useRef(0);
  const filtersOpenRef = useRef(false);

  const categoriesFlat = useMemo(() => flattenCategories(categories), [categories]);
  const filtersKey = useMemo(() => JSON.stringify(filters), [filters]);
  const debouncedSearch = useDebouncedValue(search.trim(), 300);

  useEffect(() => {
    platform.ready();
    apiGet('/api/catalog/categories').then((data) => setCategories(data.categories || []));
    apiGet('/api/me', {}, platform).then(setMe).catch(() => setMe({ user: null, isAdmin: false }));
    apiPost('/api/visits', { source: platform.name }, platform).catch(() => {});
  }, []);

  useEffect(() => {
    saveCart(cart);
  }, [cart]);

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
    const query = { categoryId, search: debouncedSearch, filters: currentFilters, page: 1, limit: 24 };
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
  }, [categoryId, debouncedSearch, filtersKey]);

  const openProduct = async (product) => {
    const detail = await apiGet(`/api/catalog/products/${encodeURIComponent(product.externalId)}`);
    setSelectedProduct(detail.product);
    setView('product');
  };

  const onAdd = (product) => {
    setCart(addToCart(cart, product));
  };

  const cartCount = getCartItems(cart).reduce((sum, item) => sum + item.quantity, 0);
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
      {view === 'home' && <HomeScreen categories={categories} facets={facets} products={products} search={search} setSearch={setSearch} setCategoryId={setCategoryId} setFilters={setFilters} setView={setView} onOpen={openProduct} onAdd={onAdd} cartCount={cartCount} />}
      {view === 'catalogMenu' && <CatalogMenuScreen categories={categories} setCategoryId={setCategoryId} setFilters={setFilters} setSearch={setSearch} setView={setView} cartCount={cartCount} />}
      {view === 'catalog' && <CatalogScreen categoriesFlat={categoriesFlat} categoryId={categoryId} setCategoryId={setCategoryId} products={products} pagination={pagination} facets={facets} filters={filters} setFilters={setFilters} search={search} setSearch={setSearch} setView={setView} onOpen={openProduct} onAdd={onAdd} loading={loading} cartCount={cartCount} />}
      {view === 'product' && <ProductScreen product={selectedProduct} setView={setView} onAdd={onAdd} cartCount={cartCount} />}
      {view === 'cart' && <CartScreen cart={cart} setCart={setCart} setView={setView} cartCount={cartCount} />}
      {view === 'checkout' && <CheckoutScreen cart={cart} platform={platform} setCart={setCart} setView={setView} cartCount={cartCount} />}
      {view === 'orders' && <OrdersScreen platform={platform} me={me} setView={setView} cartCount={cartCount} />}
      {view === 'admin' && <AdminGuard me={me} setView={setView}><AdminMenu setView={setView} /></AdminGuard>}
      {view === 'adminSettings' && <AdminGuard me={me} setView={setView}><AdminSettingsScreen platform={platform} setView={setView} /></AdminGuard>}
      {view === 'adminVisitors' && <AdminGuard me={me} setView={setView}><AdminVisitorsScreen platform={platform} setView={setView} /></AdminGuard>}
      {view === 'adminOrders' && <AdminGuard me={me} setView={setView}><AdminOrdersScreen platform={platform} setView={setView} /></AdminGuard>}
      {view === 'catalog' ? <FloatingFilterButton onClick={openFilters} count={selectedFiltersCount} /> : null}
      <FiltersSheet open={filtersOpen} facets={facets} filters={filters} setFilters={setFilters} onClose={closeFilters} />
      {!['product', 'checkout', 'admin', 'adminSettings', 'adminVisitors', 'adminOrders'].includes(view) ? <BottomNav view={view} setView={setView} cartCount={cartCount} /> : null}
    </div>
  );
}

createRoot(document.getElementById('root')).render(<App />);
