# DV Keramik Telegram Mini App MVP

Mobile-first Telegram Mini App catalog for DV Keramik. The app imports products from the YML feed into a local PostgreSQL database, serves catalog APIs from that database only, stores request/orders, and can notify a Telegram manager chat when bot credentials are configured.

The parent DV Keramik server remains the source of truth for graphic and media content. The Mini App stores textual/catalog data and original remote image URL references in PostgreSQL. It may create disposable optimized WebP derivatives in a local filesystem cache for faster mobile browsing, but it does not store image binaries/base64 in PostgreSQL and cached files are safe to delete and regenerate from `product_images.remote_url`.

## What Is Included

- React/Vite mobile UI for Home, Catalog, Filters, Product, Cart, Checkout, and Orders.
- Express API for catalog, facets, products, orders, health, and protected manual import.
- PostgreSQL schema migrations in `migrations/`.
- YML importer for `https://dvkeramik.ru/yml_get/26`.
- Telegram WebApp adapter plus browser fallback and MAX stub.
- Docker Compose with `db`, `app`, and daily `import-cron` service.

## Catalog Data And Images

The importer downloads only the YML feed from `DVKERAMIK_YML_URL`. It persists category/product text, params, prices, availability, category tree, and order snapshots in PostgreSQL. Product pictures are persisted only as normalized absolute HTTP(S) remote URLs in `product_images.remote_url`.

If the feed contains relative picture paths, the importer normalizes them against the parent source domain. Catalog APIs return the original remote URLs and, when the image cache is enabled, safe derivative URLs for optimized thumbnails/previews.

User-facing catalog APIs read from the local database only. They do not fetch the YML feed. Image derivative requests read `product_images.remote_url` from PostgreSQL by image id and never accept arbitrary source URLs.

## Product Image Gallery

Product listing responses return a single primary remote image URL for each product plus optimized `thumbnailUrl`, `listImageUrl`, and `primaryImage` fields when the cache is enabled. Product detail responses return the full `images` array from `product_images`, ordered by `sort_order` and then `id`, with exact duplicate remote URLs removed from the response. Each detail image keeps `remoteUrl` and adds `thumbUrl`, `detailUrl`, and `viewerUrl`.

The mobile frontend renders product cards, cart images, product detail images, thumbnails, and the full-screen image viewer with `object-fit: contain`. This keeps ceramic tile, mosaic, packaging, and interior photos fully visible instead of cropping them. Thumbnail strips are horizontally scrollable and do not create body-level horizontal overflow.

Product cards and cart rows use the smaller list/thumb derivative URLs. Product detail uses the `detail` derivative for the main image, `thumb` for thumbnail strips, and `viewer` in the full-screen viewer with the original remote URL as fallback. Browser or Telegram WebView loads the optimized Mini App endpoint first and falls back to the parent DV Keramik URL if a derivative is unavailable.

## Disposable Image Cache

The image cache endpoint is:

```text
GET /api/media/image/:imageId/:variant
```

`imageId` must be an existing `product_images.id` value. The endpoint looks up `product_images.remote_url` in PostgreSQL, validates the host, downloads only that stored URL, creates a WebP derivative, and serves the cached file on later requests. It is not an open proxy and does not support `?url=...`.

Allowed variants:

- `thumb`: 160px wide by default, for thumbnail strips.
- `list`: 360px wide by default, for product lists and cart rows.
- `detail`: 1200px wide by default, for the product detail main image.
- `viewer`: 1800px wide by default, for the full-screen viewer.

The cache stores only disposable optimized derivatives under `IMAGE_CACHE_DIR`, for example `/var/cache/dvkeramik-miniapp/images` in production or `telegram-miniapp/.cache/images` in local development. Cache filenames are based on image id, remote URL hash, variant, and processing options. The original remote URL remains in PostgreSQL and remains the source of truth.

Safety controls:

- Only `http:` and `https:` source URLs from `IMAGE_CACHE_ALLOWED_HOSTS` are allowed.
- Defaults allow only `dvkeramik.ru` and `www.dvkeramik.ru`.
- DNS results and the connected upstream IP must be public, not localhost/private/reserved.
- Redirects are limited and revalidated.
- Upstream content type must be `image/*`.
- Source downloads have timeout and max-byte limits.
- Cached files are written atomically and can be deleted at any time.

To clear cache:

```bash
rm -rf /var/cache/dvkeramik-miniapp/images/*
```

Optional prewarm:

```bash
pnpm images:prewarm -- --limit=200 --variants=list,thumb --concurrency=3
```

Prewarm is optional. Lazy on-demand generation works without it.

## Clean White UI

The Mini App uses a clean white catalog UI: the main page background is `#FFFFFF`, product/card surfaces are white, secondary image/input surfaces use soft neutral gray, and red is reserved for primary actions and active states. Product cards, cart images, product detail images, thumbnails, and the viewer use `object-fit: contain` so remote catalog images stay fully visible.

Imported product text is not mutated in PostgreSQL or during import. The frontend may apply display-only title formatting to calm obviously all-caps Russian product names while preserving source data, SKU/model codes, dimensions, and remote image URL references.

## DNS-Style Catalog Filters

The mobile catalog uses a DNS-style full-screen filter interface for large ceramic facet sets. The UI opens from the floating filter button, keeps edits in a draft state, and applies them only after the user taps `Применить`.

Filter groups and option values are generated from imported PostgreSQL catalog data:

- `products.available` for availability.
- `products.price` for the price range.
- `products.params_json` for material size, thickness, color, surface, collection, vendor, country, and any other imported YML params.

No frontend filter group or option value is hardcoded. The API may apply display-order preferences for known Russian param names, but unknown imported params are still returned as filter groups.

`GET /api/catalog/facets` returns the legacy fields used by the home/catalog quick UI and a DNS-ready shape:

```json
{
  "facets": {
    "total": 193,
    "selectedCount": 2,
    "groups": [
      {
        "key": "availability",
        "label": "Наличие",
        "type": "checkbox",
        "selectedCount": 1,
        "totalOptions": 2,
        "options": [
          { "value": "available", "label": "В наличии", "count": 189, "selected": true }
        ]
      },
      {
        "key": "price",
        "label": "Цена",
        "type": "range",
        "min": 10,
        "max": 123562,
        "selectedMin": null,
        "selectedMax": null
      },
      {
        "key": "param:Размер материала",
        "paramName": "Размер материала",
        "label": "Размер материала",
        "type": "checkbox",
        "selectedCount": 1,
        "options": [
          { "value": "600*1200", "label": "600*1200", "count": 189, "selected": true }
        ]
      }
    ]
  }
}
```

Catalog APIs support the existing JSON query style:

```bash
curl 'http://localhost:3001/api/catalog/products?filters={"availability":"true","minPrice":"1000","params":{"Размер материала":["600*1200","600х600"]}}'
```

They also accept explicit query aliases for smoke checks and integrations:

```bash
curl 'http://localhost:3001/api/catalog/products?available=true&priceMin=1000&priceMax=5000&filters[param:Размер материала]=600*1200,600х600'
```

The products endpoint is page-based and also accepts `page`, `limit`, and `sort`:

```bash
curl 'http://localhost:3001/api/catalog/products?page=2&limit=24&sort=price_asc'
```

Supported sort values are `default`, `price_asc`, `price_desc`, `name_asc`, `availability_desc`, and `newest`. Product responses include `pagination.page`, `pagination.limit`, `pagination.total`, `pagination.totalPages`, `pagination.hasNextPage`, `pagination.hasMore`, and `pagination.nextPage`; the frontend uses this shape for the "Show more" catalog control.

Multiple values inside the same param group behave as OR. Different groups, availability, price, category, and search behave as AND. Facet counts are computed from local PostgreSQL data in the API process. For MVP performance, counts are exact within the current category/search/price/availability context and account for other selected param groups when computing each param group.

## Catalog Controls

The mobile catalog supports:

- selected filter chips near the top of the catalog; each chip can be removed and the clear action resets all filters;
- a compact sort select using the documented `/api/catalog/products?sort=...` values;
- a list/grid view toggle saved in `localStorage` under `dvkeramik.catalog.viewMode`;
- a "Показать ещё" button that requests `nextPage`, appends products, deduplicates already loaded products, and hides when `pagination.hasMore` is false.

The DNS-style filter screen remains the main filter editing surface. The catalog chips reflect the same filter state, so removing chips in the catalog updates the filter screen state on the next open.

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
IMAGE_CACHE_ENABLED=true
IMAGE_CACHE_DIR=/var/cache/dvkeramik-miniapp/images
IMAGE_CACHE_ALLOWED_HOSTS=dvkeramik.ru,www.dvkeramik.ru
IMAGE_CACHE_MAX_SOURCE_BYTES=15000000
IMAGE_CACHE_FETCH_TIMEOUT_MS=8000
IMAGE_CACHE_QUALITY=78
IMAGE_CACHE_THUMB_WIDTH=160
IMAGE_CACHE_LIST_WIDTH=360
IMAGE_CACHE_DETAIL_WIDTH=1200
IMAGE_CACHE_VIEWER_WIDTH=1800
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

For production image cache, create a writable cache directory for the app user:

```bash
mkdir -p /var/cache/dvkeramik-miniapp/images
chown -R <app-user>:<app-user> /var/cache/dvkeramik-miniapp
```

The cache directory must not be inside a git-tracked source tree. It is safe to remove; derivatives regenerate from `product_images.remote_url`.

## Manual Import

```bash
pnpm import:dvkeramik
```

Or through the protected endpoint:

```bash
curl -X POST http://localhost:3001/api/admin/import/dvkeramik \
  -H "x-import-secret: $IMPORT_SECRET"
```

The endpoint is disabled unless `IMPORT_SECRET` or `ADMIN_IMPORT_SECRET` is configured. The importer stores picture references as remote URLs only; it does not write image files to disk or to database binary fields. Image cache derivatives are generated later by `/api/media/image/:imageId/:variant` from the stored DB URLs.

## API Smoke Checks

```bash
curl http://localhost:3001/api/health
curl http://localhost:3001/api/catalog/categories
curl "http://localhost:3001/api/catalog/products?limit=6"
curl http://localhost:3001/api/catalog/facets
```

## Telegram Integration

The frontend loads `https://telegram.org/js/telegram-web-app.js`. When opened inside Telegram, it sends `x-telegram-init-data` to the API. If `TELEGRAM_BOT_TOKEN` is present, the server verifies initData. Outside Telegram, the browser adapter creates a local dev user id and sends `x-dev-telegram-user-id`, so the MVP remains usable in a normal browser.

### Telegram Safe Area

The frontend bridges Telegram Mini App viewport and safe-area values into CSS variables. In Telegram, `safeAreaInset`, `contentSafeAreaInset`, `viewportHeight`, and `viewportStableHeight` are copied to `--tg-safe-*`, `--tg-content-safe-*`, `--tg-viewport-height`, and `--tg-viewport-stable-height`. Layout uses `--app-safe-top`, `--app-safe-bottom`, `--app-safe-left`, `--app-safe-right`, and `--app-viewport-height`.

The bridge updates on startup, after `Telegram.WebApp.ready()` / `expand()`, window resize/orientation changes, and Telegram events: `viewportChanged`, `safeAreaChanged`, `contentSafeAreaChanged`, and `fullscreenChanged`.

Browser fallback keeps the same variables backed by CSS `env(safe-area-inset-*)` and `100dvh`. To smoke-test overlap handling outside Telegram, temporarily set CSS variables in DevTools or Playwright, for example `--tg-content-safe-top: 64px` and `--tg-safe-bottom: 24px`, then open filters, product detail, image viewer, and bottom navigation.

## Known MVP Limits

- No online payment.
- MAX is a stub adapter only.
- Pagination is page-based, not infinite scroll.
- Facets are generated from imported local product data and computed in the API process for MVP simplicity.
- DNS-style filter counts are calculated in memory from the already-loaded local DB product set; this is suitable for the current MVP catalog size and should be revisited if the catalog grows substantially.
