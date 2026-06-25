# Draft PR: Harden admin-only Yandex Image Finder add-on

## Summary

Adds and hardens the CS-Cart add-on `yandex_image_finder`. The add-on lets administrators search Yandex Images from a product edit page, review candidates, and manually import an approved candidate as an additional product image or, after explicit confirmation, as the main product image.

The repository contains only the add-on package. CS-Cart conventions were checked against the target CS-Cart 4.17.2.SP3 installation in read-only mode; no deployment was performed.

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
- `MANUAL_QA.md`
- `PR_SUMMARY.md`

## Installation steps

1. Copy the package contents into the CS-Cart root.
2. Clear CS-Cart cache.
3. Install and enable `Yandex Image Finder` in **Add-ons**.
4. Configure Yandex Cloud credentials in the add-on settings.
5. Open a product edit page and use the `Yandex Image Finder` tab.

## Yandex Cloud settings

- Yandex Cloud Folder ID.
- Service account or principal with Search API access, for example `search-api.webSearch.user`.
- API key for Search API execution, or an IAM token.
- Do not commit real credentials. The add-on settings use password fields for `api_key` and `iam_token` on this CS-Cart version.

## Manual QA checklist

- Open add-on settings and confirm API key / IAM token inputs are protected password fields.
- Confirm no credentials are rendered in product-page templates, AJAX responses, or page source.
- Search from a product edit page and verify the AJAX request includes `security_hash`.
- Reject a candidate and confirm status changes without a full page reload.
- Import a candidate as an additional image and confirm it is appended to the product gallery.
- Import a candidate as the main image only after the explicit confirmation prompt.
- Confirm existing additional images are not removed by additional imports or main-image replacement.
- Attempt to import the same URL and the same file checksum again; both should be rejected as already imported.
- Try invalid or unsafe sources: localhost/private IP, redirect to private IP, unsupported MIME, tiny image, oversized image.

## Security notes

- Admin AJAX POST forms include an explicit CS-Cart `security_hash`; the target CS-Cart version also auto-injects this hash through the backend Smarty form filter.
- Image downloads reject non-HTTP(S) URLs, URLs with credentials, private/reserved/localhost IPs, disallowed domains, blocked domains, excessive redirects, unsupported MIME types, tiny images, oversized files, duplicate URLs, and duplicate checksums.
- SSRF hardening validates resolved IPs before download, pins hostname DNS results through `CURLOPT_RESOLVE`, keeps redirect validation, and verifies `CURLINFO_PRIMARY_IP` after cURL finishes.
- DNS rebinding protection fails closed for hostname downloads if the PHP/cURL runtime does not expose `CURLOPT_RESOLVE`.
- Yandex API calls and original-image imports are server-side. Imported images are downloaded to a temporary path, validated, then passed to CS-Cart image APIs.
- `fn_update_image_pairs` usage was checked against CS-Cart 4.17.2.SP3: type `A` appends additional images; type `M` updates/replaces the existing main image when no `pair_id` is passed; existing additional images are not removed.

## Known limitations

- Candidate thumbnails are not proxied. The admin browser loads `thumbnail_url` directly from external hosts with `referrerpolicy="no-referrer"`.
- The add-on parses Yandex Search API `rawData` XML. If Yandex changes XML field names, parser mapping may need adjustment.
- The default `JPEG/PNG` format setting validates both formats during import but does not send a single combined format filter to Yandex, because the Search API format filter supports one explicit format value.
- The add-on does not include real Yandex credentials.
