# Yandex Image Finder manual QA

1. Copy the package contents into the CS-Cart root.
2. In **Add-ons**, install and enable `Yandex Image Finder`.
3. Open add-on settings and enter a Yandex Cloud API key or IAM token plus Folder ID.
4. Open an existing product in the admin panel and select the `Yandex Image Finder` tab.
5. Verify that the generated query can be edited.
6. Click `Найти изображения` and confirm that candidate cards render without exposing credentials in the page source.
7. Open a candidate source page in a new tab.
8. Reject one candidate and confirm its status changes.
9. Import one candidate as an additional image and confirm a new product gallery image appears.
10. Import one candidate as the main image only after explicit confirmation.
11. Attempt to import the same candidate again and confirm it is rejected as already imported.
12. Test an intentionally broken image candidate in the database and confirm import fails safely.

Security checks:

- Confirm Yandex API calls are made only by `controllers/backend/yandex_image_finder.php`.
- Confirm `api_key` and `iam_token` are not rendered in templates or responses.
- Confirm private/localhost URLs are rejected by `fn_yandex_image_finder_is_url_safe_to_fetch`.
- Confirm SVG, HTML, tiny images, oversized files, and non-JPEG/PNG files are rejected.
