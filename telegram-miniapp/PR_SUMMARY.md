# DV Keramik Telegram Mini App MVP

## Summary

Implemented the first deployable MVP of a Telegram Mini App catalog for DV Keramik as an isolated `telegram-miniapp/` subproject. The CS-Cart add-on files are not changed.

## Changed Files

- `telegram-miniapp/package.json`
- `telegram-miniapp/index.html`
- `telegram-miniapp/vite.config.js`
- `telegram-miniapp/server/*`
- `telegram-miniapp/src/client/*`
- `telegram-miniapp/migrations/001_init.sql`
- `telegram-miniapp/Dockerfile`
- `telegram-miniapp/docker-compose.yml`
- `telegram-miniapp/.env.example`
- `telegram-miniapp/README.md`

## Database Migrations

`migrations/001_init.sql` creates:

- `categories`
- `products`
- `product_images`
- `import_runs`
- `telegram_users`
- `orders`
- `order_items`
- `schema_migrations` is created by the migration runner.

## Required Env Variables

- `DATABASE_URL`
- `DVKERAMIK_YML_URL`

Optional:

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_ADMIN_CHAT_ID`
- `TELEGRAM_BOT_USERNAME`
- `MINIAPP_PUBLIC_URL`
- `IMPORT_SECRET` or `ADMIN_IMPORT_SECRET`

## How To Run Locally

```bash
cd telegram-miniapp
pnpm install
cp .env.example .env
docker compose up -d db
pnpm db:migrate
pnpm import:dvkeramik
pnpm dev
```

## Product Import

Manual:

```bash
pnpm import:dvkeramik
```

Protected API:

```bash
curl -X POST http://localhost:3001/api/admin/import/dvkeramik \
  -H "x-import-secret: $IMPORT_SECRET"
```

The importer downloads the YML feed server-side, upserts categories/products/images, stores params as JSONB, records `import_runs`, and hides products missing from the latest import.

## Daily Import

`docker-compose.yml` includes `import-cron`, which runs migrations, imports once, and repeats every 24 hours. The interval can be adjusted with `IMPORT_INTERVAL_SECONDS`.

## Telegram Mini App Integration

The client uses a platform adapter layer:

- Telegram adapter reads `window.Telegram.WebApp`, initData, and user data.
- Browser adapter allows dev mode outside Telegram.
- MAX adapter is intentionally a stub.

Orders are always saved. Telegram manager notification is best-effort and only runs when bot env variables exist.

## Tested

- `pnpm check`
- `pnpm db:migrate`
- `pnpm import:dvkeramik`
- Real YML parse from `https://dvkeramik.ru/yml_get/26`: `2906` categories, `193` offers.
- Real import into PostgreSQL over SSH tunnel:
  - first completed run: `2906` categories, `193` offers, `193` products created;
  - second completed run: `0` products created, `193` products updated, `0` hidden.
- Smoke endpoints:
  - `/api/health`
  - `/api/catalog/categories`
  - `/api/catalog/products`
  - `/api/catalog/facets`
  - `/api/catalog/products/:id`
  - `POST /api/orders`
  - `GET /api/orders`
  - `/`

## Known Limitations

- No online payment.
- MAX is not implemented.
- Facets are computed in API memory for MVP simplicity.
- Exact Figma extraction was not available from this repository; UI follows the supplied MVP structure and mobile-first constraints.
- Docker Compose file is provided, but Docker was not available on the local Windows runner. PostgreSQL validation was performed on the prepared empty server via SSH tunnel.

## Next Steps

- Configure a real Telegram bot and Mini App URL.
- Put the app behind HTTPS.
- Add manager-facing admin list for requests.
- Add proper analytics and import monitoring.
