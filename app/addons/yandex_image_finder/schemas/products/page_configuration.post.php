<?php

defined('BOOTSTRAP') or die('Access denied');

$schema['yandex_image_finder'] = [
    'position'    => 2100,
    'title'       => 'yandex_image_finder',
    'is_optional' => true,
    'sections'    => [
        'main' => [
            'is_optional' => false,
            'title'       => 'yandex_image_finder',
            'position'    => 100,
            'fields'      => [
                'finder' => [
                    'is_optional' => false,
                    'title'       => 'yandex_image_finder',
                    'position'    => 100,
                ],
            ],
        ],
    ],
];

return $schema;
