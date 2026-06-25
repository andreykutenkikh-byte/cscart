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

    if (!function_exists('db_get_field')) {
        function db_get_field($query)
        {
            $args = func_get_args();

            return isset($args[2]) && $args[2] === 'known_checksum' ? 123 : 0;
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

    echo "OK\n";
}
