# DV Keramik Telegram Mini App MVP

Mobile-first Telegram Mini App catalog for DV Keramik. The app imports products from the YML feed into a local PostgreSQL database, serves catalog APIs from that database only, stores request/orders, and can notify a Telegram manager chat when bot credentials are configured.

Graphic and media content stays on the parent DV Keramik server. The Mini App stores textual/catalog data and remote image URL references only; it does not download, proxy, cache, resize, thumbnail, base64-encode, or store image binaries.

## What Is Included

- React/Vite mobile UI for Home, Catalog, Filters, Product, Cart, Checkout, and Orders.
- Express API for catalog, facets, products, orders, health, and protected manual import.
- PostgreSQL schema migrations in `migrations/`.
- YML importer for `https://dvkeramik.ru/yml_get/26`.
- Telegram WebApp adapter plus browser fallback and MAX stub.
- Docker Compose with `db`, `app`, and daily `import-cron` service.

## Catalog Data And Images

The importer downloads only the YML feed from `DVKERAMIK_YML_URL`. It persists category/product text, params, prices, availability, category tree, and order snapshots in PostgreSQL. Product pictures are persisted only as normalized absolute HTTP(S) remote URLs in `product_images.remote_url`.

If the feed contains relative picture paths, the importer normalizes them against the parent source domain. Frontend product cards and product details render those remote URLs directly, so Telegram WebView or the browser loads images from the parent/source server.

User-facing catalog APIs read from the local database only. They do not fetch the YML feed and do not proxy or cache images.

## Environment

Copy `.env.example` to `.env` and adjust values:

```bash
DATABASE_URL=postgres://dvkeramik:dvkeramik@localhost:5432/dvkeramik_miniapp
DVKERAMIK_YML_URL=https://dvkeramik.ru/yml_get/26
PORT=3001
HOST=0.0.0.0
TELEGRAM_BOT_TOKEN=
TELEGRAM_ADMIN_CHAT_ID=
TELEGRAM_BOT_USERNAME=
MINIAPP_PUBLIC_URL=
ADMIN_TELEGRAM_USERNAMES=andreykutenkikh
ADMIN_TELEGRAM_IDS=
IMPORT_SECRET=change-me
```

Telegram bot variables are optional. If they are missing or notification fails, `/api/orders` still saves the request in the database.

## Admin Access

The admin panel is visible in the Orders/Profile area only after the backend confirms admin access with `/api/me`. Admin APIs are protected server-side and do not trust frontend-only checks.

Production admin access requires verified Telegram `initData`. Set one or both:

```bash
ADMIN_TELEGRAM_USERNAMES=andreykutenkikh
ADMIN_TELEGRAM_IDS=123456789
TELEGRAM_BOT_TOKEN=...
```

Username checks are case-insensitive and ignore a leading `@`. Numeric Telegram ids are preferred when available. If `TELEGRAM_BOT_TOKEN` is missing in production, admin APIs remain closed because initData cannot be verified. For local development only, set `DEV_ADMIN_BYPASS` and send the matching `x-dev-admin-bypass` header while `NODE_ENV` is not `production`.

To find a numeric Telegram user id, open the Mini App with bot credentials configured and check `/api/me`, or use a trusted Telegram user-info bot. Do not rely on a username supplied by a client request without verified Telegram initData.

Admin endpoints:

- `GET /api/admin/settings`
- `POST /api/admin/import/run`
- `GET /api/admin/visitors`
- `GET /api/admin/orders`

## Visitor Tracking

The frontend calls `POST /api/visits` on startup. Telegram visitors are deduplicated by verified Telegram user id when initData is available. Browser fallback visitors are recorded as anonymous/browser visits and do not receive admin rights. The visitor table stores Telegram id, username, name fields, language code, source, first/last seen timestamps, visit count, user agent, and a hashed IP value.

## Order Notifications

When `TELEGRAM_BOT_TOKEN` and `TELEGRAM_ADMIN_CHAT_ID` are set, every saved order sends a formatted Telegram message to the admin chat. Notification failure never rolls back the saved order; it is logged and the user still receives success.

Telegram can send a private message only if the target user has started the bot. Alternatively, set `TELEGRAM_ADMIN_CHAT_ID` to a group/channel chat id where the bot is present and allowed to send messages.

## Local Development

```bash
pnpm install
cp .env.example .env
docker compose up -d db
pnpm db:migrate
pnpm import:dvkeramik
pnpm dev
```

Vite runs the frontend on `http://localhost:5173` and proxies `/api` to the Express server on `http://localhost:3001`.

## Production Build

```bash
pnpm build
pnpm start
```

The Express server serves the built Mini App and `/api/*`.

## Docker Compose

```bash
cp .env.example .env
docker compose up --build
docker compose exec app node server/import-cli.js
```

The `app` service runs migrations before starting the API. The `import-cron` service also runs migrations on boot, imports once, then repeats every 24 hours. Override with `IMPORT_INTERVAL_SECONDS`. PostgreSQL is bound to `127.0.0.1` for local development and is otherwise reachable only by Compose services.

For reverse-proxy production deployments, set `HOST=127.0.0.1` so the Node service is reachable only by the local proxy and public traffic uses HTTPS.

## Manual Import

```bash
pnpm import:dvkeramik
```

Or through the protected endpoint:

```bash
curl -X POST http://localhost:3001/api/admin/import/dvkeramik \
  -H "x-import-secret: $IMPORT_SECRET"
```

The endpoint is disabled unless `IMPORT_SECRET` or `ADMIN_IMPORT_SECRET` is configured. The importer stores picture references as remote URLs only; it does not write image files to disk or to database binary fields.

## API Smoke Checks

```bash
curl http://localhost:3001/api/health
curl http://localhost:3001/api/catalog/categories
curl "http://localhost:3001/api/catalog/products?limit=6"
curl http://localhost:3001/api/catalog/facets
```

## Telegram Integration

The frontend loads `https://telegram.org/js/telegram-web-app.js`. When opened inside Telegram, it sends `x-telegram-init-data` to the API. If `TELEGRAM_BOT_TOKEN` is present, the server verifies initData. Outside Telegram, the browser adapter creates a local dev user id and sends `x-dev-telegram-user-id`, so the MVP remains usable in a normal browser.

## Known MVP Limits

- No online payment.
- MAX is a stub adapter only.
- Pagination is page-based, not infinite scroll.
- Facets are generated from imported local product data and computed in the API process for MVP simplicity.
- The UI follows the supplied Mini App direction from the brief; exact Figma extraction was not available in this codebase.
