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

function OrdersScreen({ platform }) {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    apiGet('/api/orders', {}, platform).then((data) => setOrders(data.orders || [])).catch(() => setOrders([])).finally(() => setLoading(false));
  }, []);

  return (
    <main className="screen">
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

function App() {
  const [view, setView] = useState('home');
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

  const categoriesFlat = useMemo(() => flattenCategories(categories), [categories]);

  useEffect(() => {
    platform.ready();
    apiGet('/api/catalog/categories').then((data) => setCategories(data.categories || []));
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
      {view === 'orders' && <OrdersScreen platform={platform} />}
      {!['filters', 'product', 'checkout'].includes(view) ? <BottomNav view={view} setView={setView} cartCount={cartCount} /> : null}
    </div>
  );
}

createRoot(document.getElementById('root')).render(<App />);
