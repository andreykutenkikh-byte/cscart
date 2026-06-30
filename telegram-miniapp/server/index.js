import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import express from 'express';
import { pool, query } from './db.js';
import { getCategories, getFacets, getProductDetail, getProducts } from './catalog.js';
import { createOrder, getOrders } from './orders.js';
import { importDvKeramikFeed } from './importer.js';
import { getAdminOrders, getAdminSettings, getAdminVisitors, getMe, requireAdmin, runAdminImportNow } from './admin.js';
import { recordVisit } from './visits.js';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, '..');
const app = express();
const port = Number(process.env.PORT || 3001);

app.use(express.json({ limit: '1mb' }));

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

app.get('/api/health', asyncRoute(async (req, res) => {
  const db = await query('SELECT 1 AS ok');
  const latestImport = await query(`
    SELECT status, started_at, finished_at, categories_total, offers_total, error_message
    FROM import_runs
    ORDER BY started_at DESC
    LIMIT 1
  `);
  res.json({
    status: 'ok',
    database: db.rows[0]?.ok === 1 ? 'ok' : 'unknown',
    import: latestImport.rows[0] || null
  });
}));

app.get('/api/me', asyncRoute(async (req, res) => {
  res.json(getMe(req));
}));

app.post('/api/visits', asyncRoute(async (req, res) => {
  res.json({ visit: await recordVisit(req) });
}));

app.get('/api/catalog/categories', asyncRoute(async (req, res) => {
  res.json({ categories: await getCategories() });
}));

app.get('/api/catalog/products', asyncRoute(async (req, res) => {
  res.json(await getProducts(req.query));
}));

app.get('/api/catalog/products/:id', asyncRoute(async (req, res) => {
  const product = await getProductDetail(req.params.id);
  if (!product) {
    res.status(404).json({ error: 'Product not found' });
    return;
  }
  res.json({ product });
}));

app.get('/api/catalog/product/:id', asyncRoute(async (req, res) => {
  const product = await getProductDetail(req.params.id);
  if (!product) {
    res.status(404).json({ error: 'Product not found' });
    return;
  }
  res.json({ product });
}));

app.get('/api/catalog/facets', asyncRoute(async (req, res) => {
  res.json({ facets: await getFacets(req.query) });
}));

app.post('/api/orders', asyncRoute(async (req, res) => {
  const result = await createOrder(req);
  res.status(201).json({
    order: {
      id: result.order.id,
      status: result.order.status,
      totalPrice: Number(result.order.total_price || 0),
      createdAt: result.order.created_at
    }
  });
}));

app.get('/api/orders', asyncRoute(async (req, res) => {
  res.json({ orders: await getOrders(req) });
}));

app.get('/api/admin/me', asyncRoute(async (req, res) => {
  const identity = requireAdmin(req);
  res.json({ ...getMe(req), admin: { username: identity.username, telegramUserId: identity.telegramUserId } });
}));

app.get('/api/admin/settings', asyncRoute(async (req, res) => {
  requireAdmin(req);
  res.json({ settings: await getAdminSettings() });
}));

app.get('/api/admin/visitors', asyncRoute(async (req, res) => {
  requireAdmin(req);
  res.json(await getAdminVisitors(req.query));
}));

app.get('/api/admin/orders', asyncRoute(async (req, res) => {
  requireAdmin(req);
  res.json(await getAdminOrders(req.query));
}));

app.post('/api/admin/import/run', asyncRoute(async (req, res) => {
  requireAdmin(req);
  res.json({ import: await runAdminImportNow() });
}));

app.post('/api/admin/import/dvkeramik', asyncRoute(async (req, res) => {
  const expectedSecret = process.env.ADMIN_IMPORT_SECRET || process.env.IMPORT_SECRET;
  if (!expectedSecret || req.get('x-import-secret') !== expectedSecret) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }
  res.json({ import: await importDvKeramikFeed() });
}));

const distDir = path.join(appRoot, 'dist');
app.use(express.static(distDir));
app.get(/.*/, (req, res, next) => {
  if (req.path.startsWith('/api')) return next();
  res.sendFile(path.join(distDir, 'index.html'), (error) => {
    if (error) next();
  });
});

app.use((error, req, res, next) => {
  const statusCode = error.statusCode || 500;
  if (statusCode >= 500) {
    console.error(error);
  }
  res.status(statusCode).json({ error: error.message || 'Internal server error' });
});

const server = app.listen(port, () => {
  console.log(`DV Keramik Mini App listening on ${port}`);
});

process.on('SIGTERM', async () => {
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
});
