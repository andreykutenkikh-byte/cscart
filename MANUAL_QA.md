# Yandex Image Finder manual QA

1. Copy the package contents into the CS-Cart root.
2. In **Add-ons**, install and enable `Yandex Image Finder`.
3. Open add-on settings and confirm `api_key` and `iam_token` are rendered as protected password fields.
4. Enter a Yandex Cloud API key or IAM token plus Folder ID. Do not use committed credentials.
5. Open an existing product in the admin panel and select the `Yandex Image Finder` tab.
6. Verify the generated query can be edited.
7. Search for images and confirm candidate cards render without exposing credentials in page source or AJAX responses.
8. Confirm every AJAX POST form in the tab includes a `security_hash` field.
9. Confirm thumbnails load directly from their external `thumbnail_url` hosts and use `referrerpolicy="no-referrer"`.
10. Open a candidate source page in a new tab.
11. Reject one candidate and confirm its status changes.
12. Import one candidate as an additional image and confirm a new product gallery image is appended.
13. Import one candidate as the main image only after explicit confirmation.
14. Confirm existing additional images remain attached after adding an additional image and after replacing the main image.
15. Attempt to import the same candidate URL again and confirm it is rejected as already imported.
16. Attempt to import a different candidate that downloads to the same checksum and confirm it is rejected as already imported.
17. Test intentionally unsafe image URLs in candidate records and confirm localhost/private IPs and redirects to private IPs are rejected.
18. Test intentionally invalid downloaded files and confirm HTML, SVG, tiny images, oversized images, and non-JPEG/PNG files fail safely.

Security checks:

- Confirm Yandex API calls are made only by `controllers/backend/yandex_image_finder.php`.
- Confirm credentials are read from CS-Cart add-on settings and are not rendered in templates.
- Confirm hostname downloads require DNS pinning through `CURLOPT_RESOLVE`.
- Confirm `CURLINFO_PRIMARY_IP` is checked after cURL and must match the prevalidated public IP list.
- Confirm `fn_update_image_pairs` is called with type `A` for additional images and type `M` only for explicit main-image replacement.
