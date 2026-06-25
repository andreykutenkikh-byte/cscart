# PR summary: Harden Yandex Image Finder

## Changed files

- `app/addons/yandex_image_finder/func.php`
- `app/addons/yandex_image_finder/controllers/backend/yandex_image_finder.php`
- `app/addons/yandex_image_finder/schemas/permissions/admin.post.php`
- `app/addons/yandex_image_finder/addon.xml`
- `app/addons/yandex_image_finder/tests/isolated_checks.php`
- `app/addons/yandex_image_finder/MANUAL_QA.md`
- `app/addons/yandex_image_finder/PR_SUMMARY.md`
- `design/backend/templates/addons/yandex_image_finder/hooks/products/update_detailed_images.post.tpl`
- `design/backend/templates/addons/yandex_image_finder/hooks/addons/addon_settings.post.tpl`
- `design/backend/templates/addons/yandex_image_finder/views/yandex_image_finder/product_tab.tpl`
- `design/backend/templates/addons/yandex_image_finder/views/yandex_image_finder/components/results.tpl`
- `design/backend/templates/addons/yandex_image_finder/views/yandex_image_finder/components/test_connection_result.tpl`
- `design/backend/css/addons/yandex_image_finder/styles.less`
- `.gitignore`
- `tools/package_yandex_image_finder.py`
- `tools/CS_CART_ADDON_PACKAGING.md`

## Installation steps

1. Build the add-on ZIP with `python tools/package_yandex_image_finder.py`.
2. Upload it in CS-Cart admin through **Add-ons -> Manage add-ons -> Upload & install add-on**.
3. Enable **Yandex Image Finder**.
4. Save add-on settings before running the connection test.

## Yandex Cloud settings

- Use API key or IAM token auth.
- Store the selected credential in the add-on password field.
- Set Yandex Cloud Folder ID.
- Grant `search-api.webSearch.user` to the identity used for Search API.
- Do not commit real Yandex credentials.

## Manual QA checklist

- Product edit page still has the existing **Yandex Image Finder** tab.
- Product edit **General** tab shows **Поиск изображений через Яндекс** immediately after **Изображения**.
- Missing credentials/Folder ID warning is visible in the product panel.
- Search runs via AJAX and updates the same panel.
- Candidate cards show thumbnail, source domain, source/source image URLs, dimensions/MIME/file size when available.
- **Открыть источник** opens source page in a new tab.
- **Загрузить как дополнительную** appends to gallery.
- **Сделать главной** replaces the main image after confirmation without removing additional images.
- **Отклонить** updates the candidate status in place.
- Settings page button **Проверить подключение к Яндексу** returns the expected success/error notification.

## Validation

- `php -l` for all add-on PHP files.
- `php app/addons/yandex_image_finder/tests/isolated_checks.php`
- `addon.xml` parse check through `simplexml_load_file`.
- `git diff --check`
- Package structure check: ZIP entries use `/`, contain `app/addons/yandex_image_finder/addon.xml`, and pass CS-Cart structure validation after extraction.
- Confirmed no CS-Cart core files changed.
- No deployment performed.

## Security notes

- All add-on AJAX POST forms include CS-Cart `security_hash`.
- `yandex_image_finder.test_connection` is POST-only and protected by admin permissions.
- Connection test performs one minimal Search API request with `docsOnPage=1`, parses `rawData`, and does not store sessions/candidates or download images.
- SSRF hardening validates URLs before download, pins DNS via `CURLOPT_RESOLVE`, keeps redirect validation, and checks `CURLINFO_PRIMARY_IP` after cURL.
- Imported files are MIME-checked and duplicate checksums are rejected.
- Admin browser loads candidate thumbnails directly from external hosts; thumbnails are not proxied in this version.
- Credentials are not included in AJAX responses, notifications, docs, or tests.

## Known limitations

- Inline product panel is placed after the standard image block via `products:update_detailed_images`; there was no core modification.
- Settings connection test uses saved settings, not unsaved form input.
- Thumbnail proxying is documented but not implemented.
- Do not package with PowerShell `Compress-Archive`; it creates Windows-style ZIP entries that CS-Cart cannot detect as a valid add-on structure.
