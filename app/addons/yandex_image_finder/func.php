<?php

use Tygh\Registry;

defined('BOOTSTRAP') or die('Access denied');

function fn_yandex_image_finder_get_setting($name, $default = '')
{
    $value = Registry::get('addons.yandex_image_finder.' . $name);

    return $value !== null && $value !== '' ? $value : $default;
}

function fn_yandex_image_finder_get_int_setting($name, $default, $min = null, $max = null)
{
    $value = (int) fn_yandex_image_finder_get_setting($name, $default);
    if ($min !== null) {
        $value = max($min, $value);
    }
    if ($max !== null) {
        $value = min($max, $value);
    }

    return $value;
}

function fn_yandex_image_finder_get_settings_summary()
{
    return [
        'auth_mode'            => fn_yandex_image_finder_get_setting('auth_mode', 'api_key'),
        'credentials_ready'    => fn_yandex_image_finder_has_credentials(),
        'folder_ready'         => fn_yandex_image_finder_get_setting('folder_id') !== '',
        'search_type'          => fn_yandex_image_finder_get_setting('search_type', 'SEARCH_TYPE_RU'),
        'family_filter'        => fn_yandex_image_finder_get_setting('family_filter', 'FAMILY_MODE_STRICT'),
        'docs_on_page'         => fn_yandex_image_finder_get_int_setting('docs_on_page', 20, 1, 60),
        'image_size_filter'    => fn_yandex_image_finder_get_setting('image_size_filter', 'IMAGE_SIZE_LARGE'),
        'image_format_filter'  => fn_yandex_image_finder_get_setting('image_format_filter', 'jpeg_png'),
        'max_file_size_mb'     => fn_yandex_image_finder_get_int_setting('max_import_file_size_mb', 8, 1, 50),
        'min_image_width'      => fn_yandex_image_finder_get_int_setting('min_image_width', 300, 1, 10000),
        'min_image_height'     => fn_yandex_image_finder_get_int_setting('min_image_height', 300, 1, 10000),
        'enable_set_main'      => fn_yandex_image_finder_get_setting('enable_set_main', 'Y'),
        'show_rights_warning'  => fn_yandex_image_finder_get_setting('show_rights_warning', 'Y'),
    ];
}

function fn_yandex_image_finder_has_credentials()
{
    $mode = fn_yandex_image_finder_get_setting('auth_mode', 'api_key');

    if ($mode === 'iam_token') {
        return fn_yandex_image_finder_get_setting('iam_token') !== '';
    }

    return fn_yandex_image_finder_get_setting('api_key') !== '';
}

function fn_yandex_image_finder_get_product_block_data($product_id, array $product_data = [])
{
    $session = fn_yandex_image_finder_get_latest_session($product_id);

    return [
        'product_id'       => (int) $product_id,
        'default_query'    => fn_yandex_image_finder_build_default_query($product_id, $product_data),
        'settings_summary' => fn_yandex_image_finder_get_settings_summary(),
        'session'          => $session,
        'candidates'       => $session ? fn_yandex_image_finder_get_candidates((int) $session['session_id']) : [],
    ];
}

function fn_yandex_image_finder_get_latest_session($product_id)
{
    return db_get_row(
        'SELECT * FROM ?:yandex_image_finder_sessions WHERE product_id = ?i ORDER BY session_id DESC',
        $product_id
    );
}

function fn_yandex_image_finder_get_candidates($session_id)
{
    return db_get_array(
        'SELECT * FROM ?:yandex_image_finder_candidates WHERE session_id = ?i ORDER BY candidate_id ASC',
        $session_id
    );
}

function fn_yandex_image_finder_build_default_query($product_id, array $product_data = [])
{
    $parts = [];
    $product_name = isset($product_data['product']) ? $product_data['product'] : '';
    $product_code = isset($product_data['product_code']) ? $product_data['product_code'] : '';

    if ($product_name === '' || $product_code === '') {
        $row = db_get_row(
            'SELECT p.product_code, d.product FROM ?:products AS p'
            . ' LEFT JOIN ?:product_descriptions AS d ON d.product_id = p.product_id AND d.lang_code = ?s'
            . ' WHERE p.product_id = ?i',
            CART_LANGUAGE,
            $product_id
        );
        $product_name = $product_name !== '' ? $product_name : (isset($row['product']) ? $row['product'] : '');
        $product_code = $product_code !== '' ? $product_code : (isset($row['product_code']) ? $row['product_code'] : '');
    }

    if ($product_name !== '') {
        $parts[] = $product_name;
    }
    if ($product_code !== '') {
        $parts[] = $product_code;
    }

    $brand = fn_yandex_image_finder_find_product_brand($product_id);
    if ($brand !== '') {
        $parts[] = $brand;
    }

    $category = fn_yandex_image_finder_find_product_category_name($product_id);
    if ($category !== '') {
        $parts[] = $category;
    }

    return fn_yandex_image_finder_sanitize_query(implode(' ', array_unique($parts)));
}

function fn_yandex_image_finder_find_product_brand($product_id)
{
    $feature_ids = db_get_fields(
        'SELECT fd.feature_id FROM ?:product_features_descriptions AS fd'
        . ' INNER JOIN ?:product_features AS f ON f.feature_id = fd.feature_id'
        . ' WHERE fd.lang_code = ?s AND (LOWER(fd.description) LIKE ?l OR LOWER(fd.description) LIKE ?l OR LOWER(fd.description) LIKE ?l OR LOWER(fd.description) LIKE ?l)'
        . ' LIMIT 5',
        CART_LANGUAGE,
        '%бренд%',
        '%производител%',
        '%brand%',
        '%manufacturer%'
    );

    foreach ($feature_ids as $feature_id) {
        $row = db_get_row(
            'SELECT pfv.value, pfv.value_int, pfv.variant_id FROM ?:product_features_values AS pfv'
            . ' WHERE pfv.product_id = ?i AND pfv.feature_id = ?i AND pfv.lang_code = ?s',
            $product_id,
            $feature_id,
            CART_LANGUAGE
        );
        if (!$row) {
            continue;
        }
        if (!empty($row['variant_id'])) {
            $variant = db_get_field(
                'SELECT variant FROM ?:product_feature_variant_descriptions WHERE variant_id = ?i AND lang_code = ?s',
                $row['variant_id'],
                CART_LANGUAGE
            );
            if ($variant !== '') {
                return trim($variant);
            }
        }
        if (!empty($row['value'])) {
            return trim($row['value']);
        }
    }

    return '';
}

function fn_yandex_image_finder_find_product_category_name($product_id)
{
    return (string) db_get_field(
        'SELECT cd.category FROM ?:products_categories AS pc'
        . ' INNER JOIN ?:category_descriptions AS cd ON cd.category_id = pc.category_id AND cd.lang_code = ?s'
        . ' WHERE pc.product_id = ?i ORDER BY pc.link_type DESC, pc.category_id ASC',
        CART_LANGUAGE,
        $product_id
    );
}

function fn_yandex_image_finder_sanitize_query($query)
{
    $query = html_entity_decode((string) $query, ENT_QUOTES, 'UTF-8');
    $query = preg_replace('/[^\p{L}\p{N}\s\-\._\/]+/u', ' ', $query);
    $noise = [
        'купить', 'купите', 'цена', 'стоимость', 'доставка', 'интернет магазин',
        'магазин', 'распродажа', 'акция', 'наличие', 'заказать',
        'buy', 'price', 'sale', 'delivery', 'shop', 'store',
    ];
    foreach ($noise as $word) {
        $query = preg_replace('/\b' . preg_quote($word, '/') . '\b/iu', ' ', $query);
    }
    $query = preg_replace('/\s+/u', ' ', trim($query));

    return mb_substr($query, 0, 400, 'UTF-8');
}

function fn_yandex_image_finder_is_query_usable($query)
{
    $query = fn_yandex_image_finder_sanitize_query($query);
    $words = preg_split('/\s+/u', $query, -1, PREG_SPLIT_NO_EMPTY);

    return mb_strlen($query, 'UTF-8') >= 3 && count($words) >= 1;
}

function fn_yandex_image_finder_check_product_access($product_id, &$product_data = null, &$error_message = '')
{
    if (!fn_check_permissions('products', 'update', 'admin', 'POST')) {
        $error_message = __('access_denied');
        return false;
    }

    $product_data = db_get_row('SELECT product_id, company_id, product_code FROM ?:products WHERE product_id = ?i', $product_id);
    if (!$product_data) {
        $error_message = __('product_not_found');
        return false;
    }

    if (function_exists('fn_allow_save_object') && !fn_allow_save_object($product_data, 'product')) {
        $error_message = __('access_denied');
        return false;
    }

    return true;
}

function fn_yandex_image_finder_search($product_id, $query, $page, &$session_id, &$error_message = '')
{
    global $auth;

    $product_data = null;
    if (!fn_yandex_image_finder_check_product_access($product_id, $product_data, $error_message)) {
        return [];
    }

    $query = fn_yandex_image_finder_sanitize_query($query);
    if (!fn_yandex_image_finder_is_query_usable($query)) {
        $error_message = __('text_no_search_phrase');
        return [];
    }

    if (!fn_yandex_image_finder_has_credentials() || fn_yandex_image_finder_get_setting('folder_id') === '') {
        $error_message = 'Yandex API credentials or Folder ID are not configured.';
        return [];
    }

    $page = max(0, (int) $page);
    $docs_on_page = fn_yandex_image_finder_get_int_setting('docs_on_page', 20, 1, 60);
    $search_type = fn_yandex_image_finder_get_setting('search_type', 'SEARCH_TYPE_RU');
    $time = TIME;

    $session_id = db_query('INSERT INTO ?:yandex_image_finder_sessions ?e', [
        'product_id'         => $product_id,
        'admin_user_id'      => isset($auth['user_id']) ? (int) $auth['user_id'] : 0,
        'query'              => $query,
        'search_type'        => $search_type,
        'page'               => $page,
        'docs_on_page'       => $docs_on_page,
        'status'             => 'running',
        'raw_response_hash'  => '',
        'error_message'      => '',
        'created_at'         => $time,
        'updated_at'         => $time,
    ]);

    $raw_response_hash = '';
    $candidates = fn_yandex_image_finder_call_yandex($query, $page, $docs_on_page, $raw_response_hash, $error_message);

    if ($error_message !== '') {
        db_query(
            'UPDATE ?:yandex_image_finder_sessions SET ?u WHERE session_id = ?i',
            [
                'status'            => 'failed',
                'raw_response_hash' => $raw_response_hash,
                'error_message'     => $error_message,
                'updated_at'        => TIME,
            ],
            $session_id
        );
        return [];
    }

    $stored_candidates = fn_yandex_image_finder_store_candidates($session_id, $product_id, $candidates);

    db_query(
        'UPDATE ?:yandex_image_finder_sessions SET ?u WHERE session_id = ?i',
        [
            'status'            => 'completed',
            'raw_response_hash' => $raw_response_hash,
            'updated_at'        => TIME,
        ],
        $session_id
    );

    return $stored_candidates;
}

function fn_yandex_image_finder_call_yandex($query, $page, $docs_on_page, &$raw_response_hash, &$error_message)
{
    if (!function_exists('curl_init')) {
        $error_message = 'PHP cURL extension is required.';
        return [];
    }

    $body = [
        'query' => [
            'searchType'  => fn_yandex_image_finder_get_setting('search_type', 'SEARCH_TYPE_RU'),
            'queryText'   => $query,
            'familyMode'  => fn_yandex_image_finder_get_setting('family_filter', 'FAMILY_MODE_STRICT'),
            'page'        => (string) max(0, (int) $page),
            'fixTypoMode' => 'FIX_TYPO_MODE_ON',
        ],
        'docsOnPage' => (string) $docs_on_page,
        'folderId'   => fn_yandex_image_finder_get_setting('folder_id'),
        'userAgent'  => 'Mozilla/5.0 (compatible; CS-Cart Yandex Image Finder/1.0)',
    ];

    $size = fn_yandex_image_finder_get_setting('image_size_filter', 'IMAGE_SIZE_LARGE');
    $size = $size === 'any' ? '' : $size;
    $format = fn_yandex_image_finder_get_setting('image_format_filter', 'jpeg_png');
    if ($size !== '' || in_array($format, ['IMAGE_FORMAT_JPEG', 'IMAGE_FORMAT_PNG'], true)) {
        $body['imageSpec'] = [];
        if ($size !== '') {
            $body['imageSpec']['size'] = $size;
        }
        if (in_array($format, ['IMAGE_FORMAT_JPEG', 'IMAGE_FORMAT_PNG'], true)) {
            $body['imageSpec']['format'] = $format;
        }
    }

    $headers = ['Content-Type: application/json'];
    if (fn_yandex_image_finder_get_setting('auth_mode', 'api_key') === 'iam_token') {
        $headers[] = 'Authorization: Bearer ' . fn_yandex_image_finder_get_setting('iam_token');
    } else {
        $headers[] = 'Authorization: Api-Key ' . fn_yandex_image_finder_get_setting('api_key');
    }

    $timeout = fn_yandex_image_finder_get_int_setting('request_timeout', 10, 1, 60);
    $ch = curl_init('https://searchapi.api.cloud.yandex.net/v2/image/search');
    curl_setopt_array($ch, [
        CURLOPT_POST           => true,
        CURLOPT_HTTPHEADER     => $headers,
        CURLOPT_POSTFIELDS     => json_encode($body),
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CONNECTTIMEOUT => min(10, $timeout),
        CURLOPT_TIMEOUT        => $timeout,
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_SSL_VERIFYHOST => 2,
    ]);
    $response = curl_exec($ch);
    $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $curl_error = curl_error($ch);
    curl_close($ch);

    if ($response === false || $status < 200 || $status >= 300) {
        $error_message = $curl_error !== '' ? $curl_error : 'Yandex API HTTP status ' . $status;
        return [];
    }

    $raw_response_hash = hash('sha256', $response);
    $decoded = json_decode($response, true);
    if (!is_array($decoded)) {
        $error_message = 'Yandex API returned invalid JSON.';
        return [];
    }

    $raw_data = isset($decoded['rawData']) ? $decoded['rawData'] : '';
    if ($raw_data === '' && isset($decoded['response']['rawData'])) {
        $raw_data = $decoded['response']['rawData'];
    }
    if ($raw_data === '') {
        $error_message = 'Yandex API response does not contain rawData.';
        return [];
    }

    return fn_yandex_image_finder_parse_raw_data($raw_data, $error_message);
}

function fn_yandex_image_finder_parse_raw_data($raw_data, &$error_message = '')
{
    $xml = base64_decode($raw_data, true);
    if ($xml === false) {
        $error_message = 'Yandex rawData is not valid Base64.';
        return [];
    }

    return fn_yandex_image_finder_parse_xml($xml, $error_message);
}

function fn_yandex_image_finder_parse_xml($xml, &$error_message = '')
{
    $previous = libxml_use_internal_errors(true);
    $document = simplexml_load_string($xml, 'SimpleXMLElement', LIBXML_NONET | LIBXML_NOCDATA);
    libxml_clear_errors();
    libxml_use_internal_errors($previous);

    if (!$document) {
        $error_message = 'Yandex XML could not be parsed.';
        return [];
    }

    $docs = $document->xpath('//*[local-name()="doc"]');
    if (!$docs) {
        $docs = $document->xpath('//*[local-name()="group"]');
    }

    $items = [];
    foreach ((array) $docs as $doc) {
        $candidate = fn_yandex_image_finder_normalize_candidate([
            'thumbnail_url'   => fn_yandex_image_finder_xml_value($doc, 'thumbnail-link'),
            'image_url'       => fn_yandex_image_finder_xml_value($doc, 'image-link'),
            'source_page_url' => fn_yandex_image_finder_xml_value($doc, 'html-link'),
            'width'           => fn_yandex_image_finder_xml_value($doc, 'original-width'),
            'height'          => fn_yandex_image_finder_xml_value($doc, 'original-height'),
            'file_size'       => fn_yandex_image_finder_xml_value($doc, 'file-size'),
            'mime_type'       => fn_yandex_image_finder_xml_value($doc, 'mime-type'),
            'source_domain'   => fn_yandex_image_finder_xml_value($doc, 'domain'),
        ]);
        if ($candidate['image_url'] !== '') {
            if (!isset($items[$candidate['image_url']])) {
                $items[$candidate['image_url']] = $candidate;
            }
        }
    }

    return array_values($items);
}

function fn_yandex_image_finder_xml_value(SimpleXMLElement $node, $name)
{
    $values = $node->xpath('.//*[local-name()="' . $name . '"]');
    if (!$values || !isset($values[0])) {
        return '';
    }

    return trim((string) $values[0]);
}

function fn_yandex_image_finder_normalize_candidate(array $candidate)
{
    $image_url = trim(isset($candidate['image_url']) ? $candidate['image_url'] : '');
    $thumbnail_url = trim(isset($candidate['thumbnail_url']) ? $candidate['thumbnail_url'] : '');
    $source_page_url = trim(isset($candidate['source_page_url']) ? $candidate['source_page_url'] : '');
    $domain = trim(isset($candidate['source_domain']) ? $candidate['source_domain'] : '');

    if ($domain === '' && $source_page_url !== '') {
        $domain = (string) parse_url($source_page_url, PHP_URL_HOST);
    }

    return [
        'image_url'       => $image_url,
        'thumbnail_url'   => $thumbnail_url,
        'source_page_url' => $source_page_url,
        'source_domain'   => mb_strtolower($domain, 'UTF-8'),
        'width'           => max(0, (int) (isset($candidate['width']) ? $candidate['width'] : 0)),
        'height'          => max(0, (int) (isset($candidate['height']) ? $candidate['height'] : 0)),
        'file_size'       => max(0, (int) (isset($candidate['file_size']) ? $candidate['file_size'] : 0)),
        'mime_type'       => trim(isset($candidate['mime_type']) ? $candidate['mime_type'] : ''),
    ];
}

function fn_yandex_image_finder_store_candidates($session_id, $product_id, array $candidates)
{
    $stored = [];
    $seen = [];

    foreach ($candidates as $candidate) {
        $candidate = fn_yandex_image_finder_normalize_candidate($candidate);
        if ($candidate['image_url'] === '') {
            continue;
        }
        $key = sha1($candidate['image_url']);
        if (isset($seen[$key])) {
            continue;
        }
        $seen[$key] = true;

        $existing_id = db_get_field(
            'SELECT candidate_id FROM ?:yandex_image_finder_candidates WHERE product_id = ?i AND image_url = ?s AND status = ?s',
            $product_id,
            $candidate['image_url'],
            YIF_STATUS_IMPORTED
        );
        $status = $existing_id ? YIF_STATUS_IMPORTED : YIF_STATUS_NEW;
        $time = TIME;
        $candidate_id = db_query('INSERT INTO ?:yandex_image_finder_candidates ?e', [
            'session_id'       => $session_id,
            'product_id'       => $product_id,
            'image_url'        => $candidate['image_url'],
            'thumbnail_url'    => $candidate['thumbnail_url'],
            'source_page_url'  => $candidate['source_page_url'],
            'source_domain'    => $candidate['source_domain'],
            'width'            => $candidate['width'],
            'height'           => $candidate['height'],
            'file_size'        => $candidate['file_size'],
            'mime_type'        => $candidate['mime_type'],
            'status'           => $status,
            'created_at'       => $time,
            'updated_at'       => $time,
        ]);
        $candidate['candidate_id'] = $candidate_id;
        $candidate['session_id'] = $session_id;
        $candidate['product_id'] = $product_id;
        $candidate['status'] = $status;
        $stored[] = $candidate;
    }

    return $stored;
}

function fn_yandex_image_finder_reject_candidate($candidate_id, $product_id, &$session_id = 0, &$error_message = '')
{
    $product_data = null;
    if (!fn_yandex_image_finder_check_product_access($product_id, $product_data, $error_message)) {
        return false;
    }

    $candidate = db_get_row(
        'SELECT * FROM ?:yandex_image_finder_candidates WHERE candidate_id = ?i AND product_id = ?i',
        $candidate_id,
        $product_id
    );
    if (!$candidate) {
        $error_message = __('object_not_found');
        return false;
    }

    $session_id = (int) $candidate['session_id'];
    db_query(
        'UPDATE ?:yandex_image_finder_candidates SET ?u WHERE candidate_id = ?i',
        [
            'status'        => YIF_STATUS_REJECTED,
            'error_message' => '',
            'updated_at'    => TIME,
        ],
        $candidate_id
    );

    return true;
}

function fn_yandex_image_finder_import_candidate($candidate_id, $product_id, $import_as, $confirm_main, &$result)
{
    $result = [
        'success'    => false,
        'session_id' => 0,
        'message'    => '',
    ];

    $product_data = null;
    if (!fn_yandex_image_finder_check_product_access($product_id, $product_data, $result['message'])) {
        return false;
    }

    $candidate = db_get_row(
        'SELECT * FROM ?:yandex_image_finder_candidates WHERE candidate_id = ?i AND product_id = ?i',
        $candidate_id,
        $product_id
    );
    if (!$candidate) {
        $result['message'] = __('object_not_found');
        return false;
    }
    $result['session_id'] = (int) $candidate['session_id'];

    if ($candidate['status'] === YIF_STATUS_IMPORTED) {
        $result['message'] = __('yif_already_imported');
        return false;
    }
    if ($candidate['status'] === YIF_STATUS_REJECTED) {
        $result['message'] = __('yif_candidate_rejected');
        return false;
    }

    $as_main = $import_as === 'main';
    if ($as_main && fn_yandex_image_finder_get_setting('enable_set_main', 'Y') !== 'Y') {
        $result['message'] = __('access_denied');
        return false;
    }

    $existing_main_pair_id = db_get_field(
        'SELECT pair_id FROM ?:images_links WHERE object_id = ?i AND object_type = ?s AND type = ?s',
        $product_id,
        'product',
        'M'
    );
    if ($as_main && $existing_main_pair_id && $confirm_main !== 'Y') {
        $result['message'] = __('yif_confirm_set_main');
        return false;
    }

    $imported_url_id = db_get_field(
        'SELECT candidate_id FROM ?:yandex_image_finder_candidates WHERE product_id = ?i AND image_url = ?s AND status = ?s',
        $product_id,
        $candidate['image_url'],
        YIF_STATUS_IMPORTED
    );
    if ($imported_url_id) {
        $result['message'] = __('yif_already_imported');
        return false;
    }

    $download = [];
    $error_message = '';
    if (!fn_yandex_image_finder_download_image($candidate['image_url'], $candidate_id, $download, $error_message)) {
        fn_yandex_image_finder_mark_candidate_failed($candidate_id, $error_message);
        $result['message'] = $error_message;
        return false;
    }

    $checksum_id = db_get_field(
        'SELECT candidate_id FROM ?:yandex_image_finder_candidates WHERE product_id = ?i AND checksum = ?s AND status = ?s',
        $product_id,
        $download['checksum'],
        YIF_STATUS_IMPORTED
    );
    if ($checksum_id) {
        @unlink($download['path']);
        $result['message'] = __('yif_already_imported');
        return false;
    }

    $pair_id = fn_yandex_image_finder_attach_product_image($product_id, $candidate, $download, $as_main);
    @unlink($download['path']);

    if (!$pair_id) {
        fn_yandex_image_finder_mark_candidate_failed($candidate_id, __('yif_import_error'));
        $result['message'] = __('yif_import_error');
        return false;
    }

    db_query(
        'UPDATE ?:yandex_image_finder_candidates SET ?u WHERE candidate_id = ?i',
        [
            'status'           => YIF_STATUS_IMPORTED,
            'imported_pair_id' => $pair_id,
            'imported_as'      => $as_main ? 'main' : 'additional',
            'checksum'         => $download['checksum'],
            'mime_type'        => $download['mime_type'],
            'file_size'        => $download['size'],
            'width'            => $download['width'],
            'height'           => $download['height'],
            'error_message'    => '',
            'updated_at'       => TIME,
        ],
        $candidate_id
    );

    $result['success'] = true;
    $result['message'] = __('yif_candidate_imported');

    return true;
}

function fn_yandex_image_finder_attach_product_image($product_id, array $candidate, array $download, $as_main)
{
    $key = 'yif_' . (int) $candidate['candidate_id'];
    $product_name = db_get_field(
        'SELECT product FROM ?:product_descriptions WHERE product_id = ?i AND lang_code = ?s',
        $product_id,
        CART_LANGUAGE
    );
    $alt = trim($product_name . ($candidate['source_domain'] ? ' - ' . $candidate['source_domain'] : ''));
    $position = (int) db_get_field(
        'SELECT MAX(position) FROM ?:images_links WHERE object_id = ?i AND object_type = ?s',
        $product_id,
        'product'
    ) + 10;

    $detailed = [
        $key => [
            'name'  => $download['filename'],
            'path'  => $download['path'],
            'size'  => $download['size'],
            'error' => 0,
        ],
    ];
    $pairs_data = [
        $key => [
            'type'         => $as_main ? 'M' : 'A',
            'object_id'    => $product_id,
            'position'     => $position,
            'image_alt'    => $alt,
            'detailed_alt' => $alt,
        ],
    ];

    $pair_ids = fn_update_image_pairs([], $detailed, $pairs_data, $product_id, 'product', [], true, CART_LANGUAGE);
    if (is_array($pair_ids)) {
        $pair_id = reset($pair_ids);
        return (int) $pair_id;
    }

    return (int) $pair_ids;
}

function fn_yandex_image_finder_mark_candidate_failed($candidate_id, $message)
{
    db_query(
        'UPDATE ?:yandex_image_finder_candidates SET ?u WHERE candidate_id = ?i',
        [
            'status'        => YIF_STATUS_FAILED,
            'error_message' => (string) $message,
            'updated_at'    => TIME,
        ],
        $candidate_id
    );
}

function fn_yandex_image_finder_download_image($url, $candidate_id, array &$download, &$error_message)
{
    if (!function_exists('curl_init')) {
        $error_message = 'PHP cURL extension is required.';
        return false;
    }

    $safe_error = '';
    if (!fn_yandex_image_finder_is_url_safe_to_fetch($url, $safe_error)) {
        $error_message = $safe_error;
        return false;
    }

    fn_yandex_image_finder_ensure_temp_dir();

    $max_size = fn_yandex_image_finder_get_int_setting('max_import_file_size_mb', 8, 1, 50) * 1024 * 1024;
    $timeout = fn_yandex_image_finder_get_int_setting('request_timeout', 10, 1, 60);
    $current_url = $url;
    $redirects_left = 3;

    while ($redirects_left >= 0) {
        $tmp = tempnam(YIF_TEMP_DIR, 'yif_');
        $fp = fopen($tmp, 'wb');
        if (!$fp) {
            $error_message = 'Unable to create temporary image file.';
            return false;
        }

        $bytes = 0;
        $limit_exceeded = false;
        $headers = [];
        $ch = curl_init($current_url);
        curl_setopt_array($ch, [
            CURLOPT_FOLLOWLOCATION => false,
            CURLOPT_CONNECTTIMEOUT => min(10, $timeout),
            CURLOPT_TIMEOUT        => $timeout,
            CURLOPT_SSL_VERIFYPEER => true,
            CURLOPT_SSL_VERIFYHOST => 2,
            CURLOPT_USERAGENT      => 'Mozilla/5.0 (compatible; CS-Cart Yandex Image Finder/1.0)',
            CURLOPT_HEADERFUNCTION => static function ($ch, $header) use (&$headers) {
                $length = strlen($header);
                $parts = explode(':', $header, 2);
                if (count($parts) === 2) {
                    $headers[strtolower(trim($parts[0]))] = trim($parts[1]);
                }
                return $length;
            },
            CURLOPT_WRITEFUNCTION => static function ($ch, $chunk) use ($fp, &$bytes, $max_size, &$limit_exceeded) {
                $length = strlen($chunk);
                $bytes += $length;
                if ($bytes > $max_size) {
                    $limit_exceeded = true;
                    return 0;
                }
                return fwrite($fp, $chunk);
            },
        ]);

        if (defined('CURLOPT_PROTOCOLS')) {
            curl_setopt($ch, CURLOPT_PROTOCOLS, CURLPROTO_HTTP | CURLPROTO_HTTPS);
        }
        if (defined('CURLOPT_REDIR_PROTOCOLS')) {
            curl_setopt($ch, CURLOPT_REDIR_PROTOCOLS, CURLPROTO_HTTP | CURLPROTO_HTTPS);
        }

        $ok = curl_exec($ch);
        $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $content_type = (string) curl_getinfo($ch, CURLINFO_CONTENT_TYPE);
        $curl_error = curl_error($ch);
        curl_close($ch);
        fclose($fp);

        if ($limit_exceeded) {
            @unlink($tmp);
            $error_message = 'Image exceeds maximum allowed file size.';
            return false;
        }

        if (in_array($status, [301, 302, 303, 307, 308], true) && !empty($headers['location'])) {
            @unlink($tmp);
            $next_url = fn_yandex_image_finder_absolutize_redirect_url($current_url, $headers['location']);
            if (!fn_yandex_image_finder_is_url_safe_to_fetch($next_url, $safe_error)) {
                $error_message = $safe_error;
                return false;
            }
            $current_url = $next_url;
            $redirects_left--;
            continue;
        }

        if ($ok === false || $status !== 200) {
            @unlink($tmp);
            $error_message = $curl_error !== '' ? $curl_error : 'Image URL returned HTTP status ' . $status;
            return false;
        }

        return fn_yandex_image_finder_validate_downloaded_image($tmp, $content_type, $candidate_id, $download, $error_message);
    }

    $error_message = 'Too many redirects while downloading image.';
    return false;
}

function fn_yandex_image_finder_validate_downloaded_image($tmp, $content_type, $candidate_id, array &$download, &$error_message)
{
    $content_type = strtolower(trim(explode(';', (string) $content_type)[0]));
    $allowed = fn_yandex_image_finder_get_allowed_mime_types();
    if (!isset($allowed[$content_type])) {
        @unlink($tmp);
        $error_message = 'Unsupported image content type: ' . ($content_type !== '' ? $content_type : 'unknown');
        return false;
    }

    $image_size = @getimagesize($tmp);
    if (!$image_size || empty($image_size[0]) || empty($image_size[1])) {
        @unlink($tmp);
        $error_message = 'Downloaded file is not a readable image.';
        return false;
    }

    $min_width = fn_yandex_image_finder_get_int_setting('min_image_width', 300, 1, 10000);
    $min_height = fn_yandex_image_finder_get_int_setting('min_image_height', 300, 1, 10000);
    if ($image_size[0] < $min_width || $image_size[1] < $min_height) {
        @unlink($tmp);
        $error_message = 'Image dimensions are smaller than allowed minimum.';
        return false;
    }

    $checksum = hash_file('sha256', $tmp);
    $filename = 'yif_' . (int) $candidate_id . '_' . substr($checksum, 0, 16) . '.' . $allowed[$content_type];
    $target = rtrim(YIF_TEMP_DIR, '/') . '/' . $filename;
    if (!rename($tmp, $target)) {
        @unlink($tmp);
        $error_message = 'Unable to move downloaded image to temporary directory.';
        return false;
    }

    $download = [
        'path'      => $target,
        'filename'  => $filename,
        'size'      => filesize($target),
        'width'     => (int) $image_size[0],
        'height'    => (int) $image_size[1],
        'mime_type' => $content_type,
        'checksum'  => $checksum,
    ];

    return true;
}

function fn_yandex_image_finder_get_allowed_mime_types()
{
    $format = fn_yandex_image_finder_get_setting('image_format_filter', 'jpeg_png');
    if ($format === 'IMAGE_FORMAT_JPEG') {
        return ['image/jpeg' => 'jpg'];
    }
    if ($format === 'IMAGE_FORMAT_PNG') {
        return ['image/png' => 'png'];
    }

    return [
        'image/jpeg' => 'jpg',
        'image/png'  => 'png',
    ];
}

function fn_yandex_image_finder_ensure_temp_dir()
{
    if (is_dir(YIF_TEMP_DIR)) {
        return true;
    }
    if (function_exists('fn_mkdir')) {
        return fn_mkdir(YIF_TEMP_DIR);
    }

    return mkdir(YIF_TEMP_DIR, 0755, true);
}

function fn_yandex_image_finder_is_url_safe_to_fetch($url, &$error_message = '')
{
    $parts = parse_url((string) $url);
    if (!$parts || empty($parts['scheme']) || empty($parts['host'])) {
        $error_message = 'Invalid image URL.';
        return false;
    }

    $scheme = strtolower($parts['scheme']);
    if (!in_array($scheme, ['http', 'https'], true)) {
        $error_message = 'Only HTTP and HTTPS image URLs are allowed.';
        return false;
    }
    if (!empty($parts['user']) || !empty($parts['pass'])) {
        $error_message = 'Image URLs with credentials are not allowed.';
        return false;
    }

    $host = strtolower(rtrim($parts['host'], '.'));
    if (!fn_yandex_image_finder_is_domain_allowed($host)) {
        $error_message = 'Image source domain is not allowed.';
        return false;
    }
    if (fn_yandex_image_finder_is_domain_blocked($host)) {
        $error_message = 'Image source domain is blocked.';
        return false;
    }

    $ips = fn_yandex_image_finder_resolve_host($host);
    if (!$ips) {
        $error_message = 'Unable to resolve image host.';
        return false;
    }

    foreach ($ips as $ip) {
        if (!filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE)) {
            $error_message = 'Image URL resolves to a private or reserved IP.';
            return false;
        }
    }

    return true;
}

function fn_yandex_image_finder_resolve_host($host)
{
    if (filter_var($host, FILTER_VALIDATE_IP)) {
        return [$host];
    }

    $ips = [];
    if (function_exists('dns_get_record')) {
        $records = @dns_get_record($host, DNS_A + DNS_AAAA);
        if (is_array($records)) {
            foreach ($records as $record) {
                if (!empty($record['ip'])) {
                    $ips[] = $record['ip'];
                }
                if (!empty($record['ipv6'])) {
                    $ips[] = $record['ipv6'];
                }
            }
        }
    }
    if (!$ips) {
        $fallback = @gethostbynamel($host);
        if (is_array($fallback)) {
            $ips = $fallback;
        }
    }

    return array_values(array_unique($ips));
}

function fn_yandex_image_finder_is_domain_allowed($host)
{
    $rules = fn_yandex_image_finder_parse_domain_list(fn_yandex_image_finder_get_setting('allowed_domains'));
    if (!$rules) {
        return true;
    }

    foreach ($rules as $rule) {
        if (fn_yandex_image_finder_domain_matches($host, $rule)) {
            return true;
        }
    }

    return false;
}

function fn_yandex_image_finder_is_domain_blocked($host)
{
    $rules = fn_yandex_image_finder_parse_domain_list(fn_yandex_image_finder_get_setting('blocked_domains'));
    foreach ($rules as $rule) {
        if (fn_yandex_image_finder_domain_matches($host, $rule)) {
            return true;
        }
    }

    return false;
}

function fn_yandex_image_finder_parse_domain_list($value)
{
    $items = preg_split('/[\r\n,]+/', (string) $value, -1, PREG_SPLIT_NO_EMPTY);
    $domains = [];
    foreach ($items as $item) {
        $item = strtolower(trim($item));
        $item = preg_replace('/^https?:\/\//', '', $item);
        $item = trim(explode('/', $item)[0]);
        $item = ltrim($item, '.');
        if ($item !== '') {
            $domains[] = $item;
        }
    }

    return array_values(array_unique($domains));
}

function fn_yandex_image_finder_domain_matches($host, $rule)
{
    return $host === $rule || substr($host, -strlen('.' . $rule)) === '.' . $rule;
}

function fn_yandex_image_finder_absolutize_redirect_url($base_url, $location)
{
    $location = trim($location);
    if (preg_match('/^https?:\/\//i', $location)) {
        return $location;
    }

    $base = parse_url($base_url);
    if (!$base || empty($base['scheme']) || empty($base['host'])) {
        return $location;
    }
    if (strpos($location, '//') === 0) {
        return $base['scheme'] . ':' . $location;
    }
    if (strpos($location, '/') === 0) {
        return $base['scheme'] . '://' . $base['host'] . $location;
    }

    $path = isset($base['path']) ? dirname($base['path']) : '';
    return $base['scheme'] . '://' . $base['host'] . rtrim($path, '/') . '/' . $location;
}
