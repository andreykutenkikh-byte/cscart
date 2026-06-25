<?php

use Tygh\Registry;

defined('BOOTSTRAP') or die('Access denied');

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $product_id = isset($_REQUEST['product_id']) ? (int) $_REQUEST['product_id'] : 0;
    $session_id = isset($_REQUEST['session_id']) ? (int) $_REQUEST['session_id'] : 0;
    $result_id = fn_yandex_image_finder_get_ajax_result_id();

    if ($mode === 'test_connection') {
        $result = [];

        if (
            !fn_check_permissions('products', 'update', 'admin', 'POST')
            && !fn_check_permissions('addons', 'update', 'admin', 'POST')
        ) {
            $result = [
                'success' => false,
                'message' => __('access_denied'),
            ];
            fn_set_notification('E', __('error'), $result['message']);
        } elseif (fn_yandex_image_finder_test_connection($result)) {
            fn_set_notification('N', __('notice'), $result['message']);
        } else {
            fn_set_notification('E', __('error'), $result['message']);
        }

        if (defined('AJAX_REQUEST')) {
            Tygh::$app['view']->assign('yif_test_result', $result);
            Tygh::$app['view']->display('addons/yandex_image_finder/views/yandex_image_finder/components/test_connection_result.tpl');
            exit;
        }

        return [CONTROLLER_STATUS_REDIRECT, 'addons.update?addon=yandex_image_finder&selected_section=settings'];
    }

    if ($mode === 'search') {
        $query = isset($_REQUEST['query']) ? (string) $_REQUEST['query'] : '';
        $page = isset($_REQUEST['page']) ? (int) $_REQUEST['page'] : 0;
        $error_message = '';

        fn_yandex_image_finder_search($product_id, $query, $page, $session_id, $error_message);
        if ($error_message !== '') {
            fn_set_notification('E', __('error'), $error_message);
        } else {
            fn_set_notification('N', __('notice'), __('yif_search_completed'));
        }

        if (defined('AJAX_REQUEST')) {
            fn_yandex_image_finder_display_results($product_id, $session_id, $result_id);
        }

        return [CONTROLLER_STATUS_REDIRECT, 'products.update?product_id=' . $product_id . '&selected_section=yandex_image_finder'];
    }

    if ($mode === 'reject') {
        $candidate_id = isset($_REQUEST['candidate_id']) ? (int) $_REQUEST['candidate_id'] : 0;
        $error_message = '';
        if (fn_yandex_image_finder_reject_candidate($candidate_id, $product_id, $session_id, $error_message)) {
            fn_set_notification('N', __('notice'), __('yif_candidate_rejected'));
        } else {
            fn_set_notification('E', __('error'), $error_message);
        }

        if (defined('AJAX_REQUEST')) {
            fn_yandex_image_finder_display_results($product_id, $session_id, $result_id);
        }

        return [CONTROLLER_STATUS_REDIRECT, 'products.update?product_id=' . $product_id . '&selected_section=yandex_image_finder'];
    }

    if ($mode === 'import') {
        $candidate_id = isset($_REQUEST['candidate_id']) ? (int) $_REQUEST['candidate_id'] : 0;
        $import_as = isset($_REQUEST['import_as']) && $_REQUEST['import_as'] === 'main' ? 'main' : 'additional';
        $confirm_main = isset($_REQUEST['confirm_main']) ? (string) $_REQUEST['confirm_main'] : 'N';
        $result = [];

        if (fn_yandex_image_finder_import_candidate($candidate_id, $product_id, $import_as, $confirm_main, $result)) {
            fn_set_notification('N', __('notice'), $result['message']);
        } else {
            fn_set_notification('E', __('error'), $result['message']);
        }

        $session_id = !empty($result['session_id']) ? (int) $result['session_id'] : $session_id;
        if (defined('AJAX_REQUEST')) {
            fn_yandex_image_finder_display_results($product_id, $session_id, $result_id);
        }

        return [CONTROLLER_STATUS_REDIRECT, 'products.update?product_id=' . $product_id . '&selected_section=yandex_image_finder'];
    }
}

return [CONTROLLER_STATUS_NO_PAGE];

function fn_yandex_image_finder_get_ajax_result_id()
{
    $result_id = isset($_REQUEST['result_ids']) ? (string) $_REQUEST['result_ids'] : '';

    return preg_replace('/[^A-Za-z0-9_\-:]/', '', $result_id);
}

function fn_yandex_image_finder_display_results($product_id, $session_id, $result_id = '')
{
    $session = $session_id
        ? db_get_row('SELECT * FROM ?:yandex_image_finder_sessions WHERE session_id = ?i AND product_id = ?i', $session_id, $product_id)
        : fn_yandex_image_finder_get_latest_session($product_id);

    Tygh::$app['view']->assign('yif_data', [
        'product_id'       => $product_id,
        'settings_summary' => fn_yandex_image_finder_get_settings_summary(),
        'session'          => $session,
        'candidates'       => $session ? fn_yandex_image_finder_get_candidates((int) $session['session_id']) : [],
    ]);
    Tygh::$app['view']->assign('yif_result_id', $result_id);
    Tygh::$app['view']->display('addons/yandex_image_finder/views/yandex_image_finder/components/results.tpl');
    exit;
}
