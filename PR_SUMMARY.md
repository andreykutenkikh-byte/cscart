# Draft PR: Add admin-only Yandex Image Finder add-on

## Summary

Adds a CS-Cart add-on, `yandex_image_finder`, that lets administrators search Yandex Images from a product edit page, review candidate images, and manually import approved images as product images.

## Changed files

- `app/addons/yandex_image_finder/addon.xml`
- `app/addons/yandex_image_finder/config.php`
- `app/addons/yandex_image_finder/init.php`
- `app/addons/yandex_image_finder/func.php`
- `app/addons/yandex_image_finder/controllers/backend/yandex_image_finder.php`
- `app/addons/yandex_image_finder/schemas/permissions/admin.post.php`
- `app/addons/yandex_image_finder/schemas/products/page_configuration.post.php`
- `app/addons/yandex_image_finder/tests/isolated_checks.php`
- `design/backend/templates/addons/yandex_image_finder/hooks/products/tabs_extra.post.tpl`
- `design/backend/templates/addons/yandex_image_finder/hooks/index/styles.post.tpl`
- `design/backend/templates/addons/yandex_image_finder/views/yandex_image_finder/product_tab.tpl`
- `design/backend/templates/addons/yandex_image_finder/views/yandex_image_finder/components/results.tpl`
- `design/backend/css/addons/yandex_image_finder/styles.less`

## Install and enable

1. Copy the package contents into the CS-Cart root.
2. Clear CS-Cart cache.
3. Install and enable `Yandex Image Finder` in the admin add-ons list.
4. Configure Yandex Cloud credentials in add-on settings.

## Required Yandex Cloud settings

- Service account with `search-api.webSearch.user`.
- API key with `yc.search-api.execute` scope, or an IAM token.
- Folder ID.

## Manual test steps

See `MANUAL_QA.md`.

## Known limitations

- The add-on uses the Yandex Search API REST image endpoint and parses `rawData` XML. If Yandex changes XML field names, parser mapping may need adjustment.
- Search API supports one image format filter at a time; the default `JPEG/PNG` setting enforces import validation for both formats and does not send a single format filter to Yandex.
- Production credentials are intentionally not included.

## Security notes

- API credentials are stored only as CS-Cart add-on settings and are never rendered in templates.
- All Yandex calls and image imports are server-side.
- Import is allowed only from stored candidates returned by a search session.
- Import rejects non-HTTP(S), localhost/private/reserved IPs, blocked domains, non-JPEG/PNG content, tiny images, oversized files, duplicate URLs, and duplicate checksums.
- Existing product images are preserved unless the admin explicitly clicks `Сделать главной` and confirms.
