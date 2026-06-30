import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Home, LayoutGrid, ShoppingCart, ClipboardList, Search, SlidersHorizontal, ChevronRight, ArrowLeft } from 'lucide-react';
import { apiGet, apiPost } from './api.js';
import { addToCart, clearCart, getCartItems, getCartTotal, loadCart, saveCart, updateQuantity } from './cart.js';
import { getPlatform } from './platform/index.js';
import './styles.css';

const platform = getPlatform();

function formatPrice(value, currency = 'RUB') {
  if (value === null || value === undefined) return 'Цена по запросу';
  return `${Number(value).toLocaleString('ru-RU')} ${currency || ''}`.trim();
}

function flattenCategories(categories, depth = 0) {
  return categories.flatMap((category) => [
    { ...category, depth },
    ...flattenCategories(category.children || [], depth + 1)
  ]);
}

function initialViewFromPath() {
  const path = window.location.pathname;
  if (path === '/admin/settings') return 'adminSettings';
  if (path === '/admin/visitors') return 'adminVisitors';
  if (path === '/admin/orders') return 'adminOrders';
  if (path === '/admin') return 'admin';
  return 'home';
}

function formatDateTime(value) {
  if (!value) return 'not available';
  return new Date(value).toLocaleString('ru-RU');
}

function ProductImage({ src, alt }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) return <div className="image-fallback">DV</div>;
  return <img src={src} alt={alt} loading="lazy" onError={() => setFailed(true)} />;
}

function ProductCard({ product, onOpen, onAdd }) {
  return (
    <article className="product-card" onClick={() => onOpen(product)}>
      <div className="product-card__image"><ProductImage src={product.remoteImageUrl || product.imageUrl} alt={product.name} /></div>
      <div className="product-card__body">
        <div className="product-card__name">{product.name}</div>
        <div className="product-card__meta">{product.available ? 'В наличии' : 'Под заказ'} · {product.sku}</div>
        <div className="product-card__bottom">
          <strong>{formatPrice(product.price, product.currencyId)}</strong>
          <button className="icon-button" onClick={(event) => { event.stopPropagation(); onAdd(product); }}>+</button>
        </div>
      </div>
    </article>
  );
}

function BottomNav({ view, setView, cartCount }) {
  const items = [
    ['home', 'Главная', Home],
    ['catalog', 'Каталог', LayoutGrid],
    ['cart', 'Корзина', ShoppingCart],
    ['orders', 'Заявки', ClipboardList]
  ];
  return (
    <nav className="bottom-nav">
      {items.map(([id, label, Icon]) => (
        <button key={id} className={view === id ? 'active' : ''} onClick={() => setView(id)}>
          <Icon size={20} />
          <span>{label}</span>
          {id === 'cart' && cartCount > 0 ? <b>{cartCount}</b> : null}
        </button>
      ))}
    </nav>
  );
}

function HomeScreen({ categories, facets, products, search, setSearch, setCategoryId, setView, onOpen, onAdd }) {
  const rootCategories = categories.slice(0, 8);
  const quickFacets = (facets?.params || []).slice(0, 4).flatMap((facet) =>
    facet.values.slice(0, 3).map((value) => ({ facet: facet.name, value: value.value }))
  ).slice(0, 8);

  return (
    <main className="screen">
      <section className="hero">
        <p>DV Keramik</p>
        <h1>Плитка, мозаика и материалы рядом</h1>
      </section>
      <label className="search-box">
        <Search size={18} />
        <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Поиск по каталогу" />
      </label>
      <section>
        <div className="section-title"><h2>Категории</h2></div>
        <div className="category-grid">
          {rootCategories.map((category) => (
            <button key={category.externalId} onClick={() => { setCategoryId(category.externalId); setView('catalog'); }}>
              {category.name}<ChevronRight size={16} />
            </button>
          ))}
        </div>
      </section>
      {quickFacets.length ? (
        <section>
          <div className="section-title"><h2>Быстрый выбор</h2></div>
          <div className="chips">
            {quickFacets.map((chip) => <span key={`${chip.facet}:${chip.value}`}>{chip.value}</span>)}
          </div>
        </section>
      ) : null}
      <section>
        <div className="section-title"><h2>Популярное</h2><button onClick={() => setView('catalog')}>Все</button></div>
        <div className="product-list">
          {products.slice(0, 8).map((product) => <ProductCard key={product.externalId} product={product} onOpen={onOpen} onAdd={onAdd} />)}
        </div>
      </section>
    </main>
  );
}

function CatalogScreen({ categoriesFlat, categoryId, setCategoryId, products, pagination, search, setSearch, setView, onOpen, onAdd, loading }) {
  return (
    <main className="screen">
      <div className="toolbar">
        <label className="search-box compact">
          <Search size={18} />
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Название, цвет, размер" />
        </label>
        <button className="filter-button" onClick={() => setView('filters')}><SlidersHorizontal size={20} /></button>
      </div>
      <select className="select" value={categoryId || ''} onChange={(event) => setCategoryId(event.target.value || '')}>
        <option value="">Все категории</option>
        {categoriesFlat.map((category) => (
          <option key={category.externalId} value={category.externalId}>
            {'— '.repeat(category.depth)}{category.name}
          </option>
        ))}
      </select>
      {loading ? <div className="empty">Загружаем каталог...</div> : null}
      {!loading && !products.length ? <div className="empty">Ничего не найдено</div> : null}
      <div className="product-list">
        {products.map((product) => <ProductCard key={product.externalId} product={product} onOpen={onOpen} onAdd={onAdd} />)}
      </div>
      {pagination?.hasNextPage ? <div className="empty">Показана первая страница. Уточните поиск или фильтры.</div> : null}
    </main>
  );
}

function FiltersScreen({ facets, filters, setFilters, setView }) {
  const selectedParams = filters.params || {};
  const toggleParam = (name, value) => {
    const current = new Set(selectedParams[name] || []);
    if (current.has(value)) current.delete(value);
    else current.add(value);
    setFilters({ ...filters, params: { ...selectedParams, [name]: [...current] } });
  };

  return (
    <main className="screen">
      <button className="back-button" onClick={() => setView('catalog')}><ArrowLeft size={18} /> Назад</button>
      <h1 className="page-title">Фильтры</h1>
      <section className="filter-section">
        <h2>Наличие</h2>
        <div className="chips">
          <button className={filters.availability === 'true' ? 'selected' : ''} onClick={() => setFilters({ ...filters, availability: filters.availability === 'true' ? '' : 'true' })}>В наличии</button>
          <button className={filters.availability === 'false' ? 'selected' : ''} onClick={() => setFilters({ ...filters, availability: filters.availability === 'false' ? '' : 'false' })}>Под заказ</button>
        </div>
      </section>
      {facets?.price?.min !== null ? (
        <section className="filter-section">
          <h2>Цена</h2>
          <div className="price-row">
            <input inputMode="numeric" placeholder={`от ${facets.price.min}`} value={filters.minPrice || ''} onChange={(event) => setFilters({ ...filters, minPrice: event.target.value })} />
            <input inputMode="numeric" placeholder={`до ${facets.price.max}`} value={filters.maxPrice || ''} onChange={(event) => setFilters({ ...filters, maxPrice: event.target.value })} />
          </div>
        </section>
      ) : null}
      {(facets?.params || []).map((facet) => (
        <section className="filter-section" key={facet.name}>
          <h2>{facet.name}</h2>
          <div className="chips">
            {facet.values.slice(0, 18).map((item) => (
              <button
                key={item.value}
                className={(selectedParams[facet.name] || []).includes(item.value) ? 'selected' : ''}
                onClick={() => toggleParam(facet.name, item.value)}
              >
                {item.value} <small>{item.count}</small>
              </button>
            ))}
          </div>
        </section>
      ))}
      <div className="sticky-actions">
        <button className="secondary" onClick={() => setFilters({ params: {} })}>Сбросить</button>
        <button className="primary" onClick={() => setView('catalog')}>Показать</button>
      </div>
    </main>
  );
}

function ProductScreen({ product, setView, onAdd }) {
  if (!product) return null;
  return (
    <main className="screen">
      <button className="back-button" onClick={() => setView('catalog')}><ArrowLeft size={18} /> Каталог</button>
      <div className="detail-image"><ProductImage src={product.images?.[0]?.remoteUrl || product.remoteImageUrl || product.imageUrl} alt={product.name} /></div>
      <h1 className="page-title">{product.name}</h1>
      <div className="detail-price">{formatPrice(product.price, product.currencyId)}</div>
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

function CartScreen({ cart, setCart, setView }) {
  const items = getCartItems(cart);
  return (
    <main className="screen">
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

function CheckoutScreen({ cart, platform, setCart, setView }) {
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

function OrdersScreen({ platform, me, setView }) {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    apiGet('/api/orders', {}, platform).then((data) => setOrders(data.orders || [])).catch(() => setOrders([])).finally(() => setLoading(false));
  }, []);

  return (
    <main className="screen">
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

  const categoriesFlat = useMemo(() => flattenCategories(categories), [categories]);

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
    setLoading(true);
    const query = { categoryId, search, filters, page: 1, limit: 24 };
    Promise.all([
      apiGet('/api/catalog/products', query),
      apiGet('/api/catalog/facets', { categoryId, search, filters })
    ]).then(([productData, facetData]) => {
      setProducts(productData.products || []);
      setPagination(productData.pagination);
      setFacets(facetData.facets);
    }).finally(() => setLoading(false));
  }, [categoryId, search, JSON.stringify(filters)]);

  const openProduct = async (product) => {
    const detail = await apiGet(`/api/catalog/products/${encodeURIComponent(product.externalId)}`);
    setSelectedProduct(detail.product);
    setView('product');
  };

  const onAdd = (product) => {
    setCart(addToCart(cart, product));
  };

  const cartCount = getCartItems(cart).reduce((sum, item) => sum + item.quantity, 0);

  return (
    <div className="app-shell">
      {view === 'home' && <HomeScreen categories={categories} facets={facets} products={products} search={search} setSearch={setSearch} setCategoryId={setCategoryId} setView={setView} onOpen={openProduct} onAdd={onAdd} />}
      {view === 'catalog' && <CatalogScreen categoriesFlat={categoriesFlat} categoryId={categoryId} setCategoryId={setCategoryId} products={products} pagination={pagination} search={search} setSearch={setSearch} setView={setView} onOpen={openProduct} onAdd={onAdd} loading={loading} />}
      {view === 'filters' && <FiltersScreen facets={facets} filters={filters} setFilters={setFilters} setView={setView} />}
      {view === 'product' && <ProductScreen product={selectedProduct} setView={setView} onAdd={onAdd} />}
      {view === 'cart' && <CartScreen cart={cart} setCart={setCart} setView={setView} />}
      {view === 'checkout' && <CheckoutScreen cart={cart} platform={platform} setCart={setCart} setView={setView} />}
      {view === 'orders' && <OrdersScreen platform={platform} me={me} setView={setView} />}
      {view === 'admin' && <AdminGuard me={me} setView={setView}><AdminMenu setView={setView} /></AdminGuard>}
      {view === 'adminSettings' && <AdminGuard me={me} setView={setView}><AdminSettingsScreen platform={platform} setView={setView} /></AdminGuard>}
      {view === 'adminVisitors' && <AdminGuard me={me} setView={setView}><AdminVisitorsScreen platform={platform} setView={setView} /></AdminGuard>}
      {view === 'adminOrders' && <AdminGuard me={me} setView={setView}><AdminOrdersScreen platform={platform} setView={setView} /></AdminGuard>}
      {!['filters', 'product', 'checkout', 'admin', 'adminSettings', 'adminVisitors', 'adminOrders'].includes(view) ? <BottomNav view={view} setView={setView} cartCount={cartCount} /> : null}
    </div>
  );
}

createRoot(document.getElementById('root')).render(<App />);
