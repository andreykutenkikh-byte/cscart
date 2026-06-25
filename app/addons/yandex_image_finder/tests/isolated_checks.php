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
              <thumbnail-link>https://img.example.com/t.jpg</thumbnail-link>
              <image-link>https://img.example.com/photo.jpg</image-link>
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

    echo "OK\n";
}
