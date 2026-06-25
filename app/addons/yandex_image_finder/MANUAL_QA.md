# Yandex Image Finder manual QA

## Installation

1. Build the add-on ZIP so the archive root contains `app/`, `design/`, and `var/`.
2. In CS-Cart admin, open **Add-ons -> Manage add-ons -> Upload & install add-on**.
3. Install and enable **Yandex Image Finder**.
4. Open the add-on settings, fill saved Yandex settings, and click **Save** before testing the connection button.

## Yandex Cloud settings

- `auth_mode`: API key or IAM token.
- `api_key` / `iam_token`: stored in password fields; never add real credentials to git.
- `folder_id`: Yandex Cloud Folder ID.
- Required role for the service account/API key: `search-api.webSearch.user`.
- Search endpoint used by the add-on: Yandex Search API image search.

## Product card placement

1. Open **Products -> Products -> Edit product**.
2. In the **General** tab, find the standard **Изображения** upload block.
3. The compact panel **Поиск изображений через Яндекс** appears immediately after that image uploader via the `products:update_detailed_images` hook.
4. The old **Yandex Image Finder** product tab remains available.
5. Search from either area; AJAX results should update only the area where the request was made.

Expected inline candidate card content:

- thumbnail;
- source domain;
- original image URL;
- source page URL;
- dimensions / MIME / file size when Yandex provides them;
- actions: **Открыть источник**, **Загрузить как дополнительную**, **Сделать главной**, **Отклонить**.

## Test Yandex connection

1. Open **Add-ons -> Manage add-ons -> Yandex Image Finder -> Settings**.
2. Save credentials and Folder ID first.
3. Click **Проверить подключение к Яндексу**.
4. Expected success notification:
   `Подключение успешно: Yandex Search API ответил, rawData получен, найдено кандидатов: N.`

Expected readable failures:

- missing credentials;
- missing Folder ID;
- HTTP 401 invalid API key / IAM token;
- HTTP 403 missing role, likely `search-api.webSearch.user`;
- HTTP 400 invalid request or Folder ID;
- HTTP 429 quota/rate limit;
- invalid JSON;
- missing `rawData`;
- XML parse error.

The connection test must not create search sessions, candidates, or downloaded files.

## Import checks

1. Search images from the inline product panel.
2. Import one image as additional; verify it is appended to product gallery.
3. Import another image as main; verify confirmation appears and the current main image is replaced without removing additional images.
4. Reject a candidate; verify the same inline area refreshes and shows rejected status.
5. Repeat search/import with a duplicate image URL or duplicate checksum; verify it is blocked as already imported.

## Security checks

- All AJAX POST forms include `security_hash`.
- Backend download rejects localhost/private/reserved IPs before and after cURL connection.
- Redirect targets are revalidated before download.
- Unsupported MIME types are rejected.
- Admin thumbnails are loaded directly by the admin browser from external hosts; this is intentional and documented.
- Credentials are not returned in AJAX responses, notifications, or source-controlled files.

## Known limitations

- The inline panel is placed immediately after the standard image uploader using the closest safe CS-Cart hook; it is not injected inside the uploader markup.
- The connection test reads saved add-on settings, so unsaved values in the settings form are not tested until **Save** is clicked.
- Candidate thumbnails are not proxied through the backend in this version.
