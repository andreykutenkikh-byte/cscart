<?php

defined('BOOTSTRAP') or die('Access denied');

defined('YIF_STATUS_NEW') or define('YIF_STATUS_NEW', 'new');
defined('YIF_STATUS_REJECTED') or define('YIF_STATUS_REJECTED', 'rejected');
defined('YIF_STATUS_IMPORTED') or define('YIF_STATUS_IMPORTED', 'imported');
defined('YIF_STATUS_FAILED') or define('YIF_STATUS_FAILED', 'failed');
defined('YIF_TEMP_DIR') or define('YIF_TEMP_DIR', DIR_ROOT . '/var/yandex_image_finder');
