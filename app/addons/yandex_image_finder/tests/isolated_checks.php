<?php

namespace Tygh {
    class Registry
    {
        public static $values = [];

        public static function get($key)
        {
            return isset(self::$values[$key]) ? self::$values[$key] : '';
        }
    }
}

namespace {
    define('BOOTSTRAP', true);
    define('DIR_ROOT', dirname(__DIR__, 4));
    define('CART_LANGUAGE', 'ru');
    define('TIME', time());

    $GLOBALS['yif_db_write_count'] = 0;

    if (!function_exists('__')) {
        function __($key)
        {
            $messages = [
                'yif_missing_yandex_credentials'    => 'Yandex credentials are not configured.',
                'yif_missing_yandex_folder_id'      => 'Yandex Folder ID is not configured.',
                'yif_test_connection_success'       => 'Connection successful: Yandex Search API responded, rawData received, candidates found: [count].',
                'yif_yandex_http_401'               => 'Yandex Search API returned HTTP 401: invalid API key or IAM token.',
                'yif_yandex_http_403'               => 'Yandex Search API returned HTTP 403: missing role, likely search-api.webSearch.user.',
                'yif_yandex_http_400'               => 'Yandex Search API returned HTTP 400: invalid request or Folder ID.',
                'yif_yandex_http_429'               => 'Yandex Search API returned HTTP 429: quota or rate limit exceeded.',
                'yif_yandex_http_error'             => 'Yandex Search API returned HTTP status [status].',
                'yif_yandex_http_unknown'           => 'Yandex Search API did not return a valid HTTP response.',
                'yif_yandex_invalid_json'           => 'Yandex Search API returned invalid JSON.',
                'yif_yandex_missing_raw_data'       => 'Yandex Search API response does not contain rawData.',
                'yif_yandex_raw_data_base64_error'  => 'Yandex rawData is not valid Base64.',
                'yif_yandex_xml_parse_error'        => 'Yandex rawData XML parse error.',
            ];

            return isset($messages[$key]) ? $messages[$key] : $key;
        }
    }

    if (!function_exists('db_get_field')) {
        function db_get_field($query)
        {
            $args = func_get_args();

            return isset($args[2]) && $args[2] === 'known_checksum' ? 123 : 0;
        }
    }
    if (!function_exists('db_get_row')) {
        function db_get_row()
        {
            return [];
        }
    }
    if (!function_exists('db_get_array')) {
        function db_get_array()
        {
            return [];
        }
    }
    if (!function_exists('db_get_fields')) {
        function db_get_fields()
        {
            return [];
        }
    }
    if (!function_exists('db_query')) {
        function db_query()
        {
            $GLOBALS['yif_db_write_count']++;

            return 1;
        }
    }

    require __DIR__ . '/../config.php';
    require __DIR__ . '/../func.php';

    function yif_assert($condition, $message)
    {
        if (!$condition) {
            fwrite(STDERR, "FAIL: {$message}\n");
            exit(1);
        }
    }

    $xml = <<<XML
<?xml version="1.0" encoding="UTF-8"?>
<yandexsearch>
  <response>
    <results>
      <grouping>
        <group>
          <doc>
            <properties>
              <thumbnail-link><![CDATA[https://img.example.com/t.jpg]]></thumbnail-link>
              <image-link><![CDATA[https://img.example.com/photo.jpg]]></image-link>
              <html-link>https://example.com/product.html</html-link>
              <original-width>1200</original-width>
              <original-height>900</original-height>
              <file-size>456789</file-size>
              <mime-type>image/jpeg</mime-type>
              <domain>example.com</domain>
            </properties>
          </doc>
        </group>
        <group>
          <doc>
            <properties>
              <thumbnail-link>https://img.example.com/t2.jpg</thumbnail-link>
              <image-link>https://img.example.com/photo.jpg</image-link>
              <html-link>https://example.com/duplicate.html</html-link>
            </properties>
          </doc>
        </group>
      </grouping>
    </results>
  </response>
</yandexsearch>
XML;

    $error = '';
    $items = fn_yandex_image_finder_parse_raw_data(base64_encode($xml), $error);
    yif_assert($error === '', 'rawData parse should not produce an error');
    yif_assert(count($items) === 1, 'duplicate image URLs should be collapsed');
    yif_assert($items[0]['source_domain'] === 'example.com', 'source domain should be extracted');
    yif_assert($items[0]['width'] === 1200 && $items[0]['height'] === 900, 'dimensions should be parsed');

    $query = fn_yandex_image_finder_sanitize_query('Купить плитку Atlas доставка цена!!!');
    yif_assert(mb_stripos($query, 'купить', 0, 'UTF-8') === false, 'query noise should be removed');
    yif_assert(mb_stripos($query, 'доставка', 0, 'UTF-8') === false, 'delivery noise should be removed');

    $candidate = fn_yandex_image_finder_normalize_candidate([
        'image_url'       => ' https://cdn.example.org/a.png ',
        'source_page_url' => 'https://shop.example.org/p/1',
    ]);
    yif_assert($candidate['source_domain'] === 'shop.example.org', 'domain should fall back to source page URL');

    $ssrf_error = '';
    yif_assert(!fn_yandex_image_finder_is_url_safe_to_fetch('http://127.0.0.1/image.jpg', $ssrf_error), 'localhost IP should be rejected');
    yif_assert(!fn_yandex_image_finder_is_url_safe_to_fetch('file:///etc/passwd', $ssrf_error), 'non-http scheme should be rejected');
    yif_assert(!fn_yandex_image_finder_is_url_safe_to_fetch('http://localhost/image.jpg', $ssrf_error), 'localhost host should be rejected');

    $redirect_url = fn_yandex_image_finder_absolutize_redirect_url('https://example.com/a/b.jpg', 'http://127.0.0.1/private.jpg');
    yif_assert(!fn_yandex_image_finder_is_url_safe_to_fetch($redirect_url, $ssrf_error), 'redirect target to private IP should be rejected');

    $resolved_ips = [];
    yif_assert(fn_yandex_image_finder_is_url_safe_to_fetch('https://8.8.8.8/image.jpg', $ssrf_error, $resolved_ips), 'public IP URL should pass SSRF checks');
    yif_assert($resolved_ips === ['8.8.8.8'], 'resolved IP list should include the validated literal IP');
    yif_assert(!fn_yandex_image_finder_is_public_ip('10.0.0.1'), 'private IP helper should reject private ranges');
    yif_assert(fn_yandex_image_finder_is_public_ip('8.8.8.8'), 'public IP helper should allow public ranges');
    yif_assert(!fn_yandex_image_finder_is_primary_ip_allowed('127.0.0.1', ['8.8.8.8']), 'primary private IP should be rejected after cURL');
    yif_assert(!fn_yandex_image_finder_is_primary_ip_allowed('8.8.4.4', ['8.8.8.8']), 'primary IP outside pinned DNS result should be rejected');
    yif_assert(fn_yandex_image_finder_is_primary_ip_allowed('8.8.8.8', ['8.8.8.8']), 'primary IP from pinned DNS result should be accepted');

    $resolve_entries = [];
    yif_assert(fn_yandex_image_finder_prepare_url_for_curl('https://8.8.8.8/image.jpg', $resolve_entries, $resolved_ips, $ssrf_error), 'public literal IP should prepare for cURL');
    yif_assert($resolve_entries === [], 'literal IP URLs should not need CURLOPT_RESOLVE entries');

    yif_assert(fn_yandex_image_finder_is_allowed_mime_type('image/jpeg; charset=binary'), 'JPEG MIME with parameters should be allowed');
    yif_assert(!fn_yandex_image_finder_is_allowed_mime_type('text/html'), 'HTML MIME should be rejected');
    yif_assert(!fn_yandex_image_finder_is_allowed_mime_type('image/svg+xml'), 'SVG MIME should be rejected');

    yif_assert(fn_yandex_image_finder_find_imported_checksum_duplicate(10, 'known_checksum') === 123, 'known checksum duplicate should be detected');
    yif_assert(fn_yandex_image_finder_find_imported_checksum_duplicate(10, '') === 0, 'empty checksum should not query as duplicate');

    \Tygh\Registry::$values = [];
    $http_called = false;
    $result = [];
    yif_assert(!fn_yandex_image_finder_test_connection($result, function () use (&$http_called) {
        $http_called = true;

        return ['response' => '{}', 'status' => 200, 'error' => ''];
    }), 'test connection should fail closed when credentials are empty');
    yif_assert(!$http_called, 'test connection should not call Yandex when credentials are empty');
    yif_assert($GLOBALS['yif_db_write_count'] === 0, 'test connection with empty credentials should not write DB rows');

    foreach ([400, 401, 403, 429] as $status) {
        yif_assert(strpos(fn_yandex_image_finder_map_yandex_http_error($status), (string) $status) !== false, "HTTP {$status} should be mapped into a readable error");
    }

    \Tygh\Registry::$values = [
        'addons.yandex_image_finder.auth_mode'      => 'api_key',
        'addons.yandex_image_finder.api_key'        => 'fake-api-key',
        'addons.yandex_image_finder.folder_id'      => 'fake-folder-id',
        'addons.yandex_image_finder.search_type'    => 'SEARCH_TYPE_RU',
        'addons.yandex_image_finder.family_filter'  => 'FAMILY_MODE_STRICT',
        'addons.yandex_image_finder.request_timeout' => '10',
    ];
    $http_calls = 0;
    $result = [];
    yif_assert(fn_yandex_image_finder_test_connection($result, function ($body, $headers, $timeout) use ($xml, &$http_calls) {
        $http_calls++;
        yif_assert($body['query']['queryText'] === 'test image', 'test connection should use the safe probe query');
        yif_assert($body['docsOnPage'] === '1', 'test connection should request one document');
        yif_assert($body['folderId'] === 'fake-folder-id', 'test connection should use configured Folder ID');
        yif_assert($timeout === 10, 'test connection should use configured timeout');

        return [
            'response' => json_encode(['rawData' => base64_encode($xml)]),
            'status'   => 200,
            'error'    => '',
        ];
    }), 'successful fake Yandex response should pass test connection');
    yif_assert($http_calls === 1, 'test connection should perform one Yandex request');
    yif_assert($result['candidates_count'] === 1, 'successful test connection should parse candidate count from rawData');
    yif_assert($GLOBALS['yif_db_write_count'] === 0, 'successful test connection should not create sessions or candidates');

    $result = [];
    yif_assert(!fn_yandex_image_finder_test_connection($result, function () {
        return [
            'response' => '{}',
            'status'   => 403,
            'error'    => '',
        ];
    }), 'HTTP error should fail test connection');
    yif_assert(strpos($result['message'], '403') !== false, 'HTTP 403 should be reported clearly');
    yif_assert($GLOBALS['yif_db_write_count'] === 0, 'failed test connection should not create sessions or candidates');

    echo "OK\n";
}
