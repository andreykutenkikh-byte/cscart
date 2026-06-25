<?php

defined('BOOTSTRAP') or die('Access denied');

$schema['yandex_image_finder'] = [
    'permissions' => [
        'GET'  => 'view_catalog',
        'POST' => 'manage_catalog',
    ],
    'modes' => [
        'search' => [
            'permissions' => 'manage_catalog',
        ],
        'reject' => [
            'permissions' => 'manage_catalog',
        ],
        'import' => [
            'permissions' => 'manage_catalog',
        ],
        'test_connection' => [
            'permissions' => 'manage_catalog',
        ],
    ],
];

return $schema;
