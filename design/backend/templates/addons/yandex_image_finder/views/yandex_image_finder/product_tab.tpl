{assign var="yif_data" value=fn_yandex_image_finder_get_product_block_data($product_id, $product_data)}
{assign var="yif_settings" value=$yif_data.settings_summary}
{assign var="yif_result_id" value="yif_results_`$product_id`"}

<div class="yif-product-tab">
    {if !$yif_settings.credentials_ready || !$yif_settings.folder_ready}
        <div class="alert alert-warning">{__("yif_settings_not_ready")}</div>
    {/if}

    <div class="yif-settings-summary muted">
        <span>{__("yif_settings_summary")}:</span>
        <span>{$yif_settings.search_type|escape}</span>
        <span>{$yif_settings.family_filter|escape}</span>
        <span>{$yif_settings.docs_on_page|escape}</span>
        <span>{$yif_settings.image_size_filter|default:__("all")|escape}</span>
        <span>{$yif_settings.image_format_filter|escape}</span>
    </div>

    <form action="{""|fn_url}"
          method="post"
          name="yif_search_form_{$product_id}"
          class="cm-ajax yif-search-form"
          data-ca-target-id="{$yif_result_id}">
        <input type="hidden" name="security_hash" value="{""|fn_generate_security_hash}" />
        <input type="hidden" name="product_id" value="{$product_id}" />
        <input type="hidden" name="result_ids" value="{$yif_result_id}" />
        <input type="hidden" name="page" value="0" />

        <div class="control-group">
            <label class="control-label" for="yif_query_{$product_id}">{__("yif_query")}</label>
            <div class="controls yif-search-controls">
                <input type="text"
                       id="yif_query_{$product_id}"
                       name="query"
                       value="{$yif_data.default_query|escape}"
                       class="input-xxlarge" />
                <button type="submit"
                        class="btn btn-primary"
                        name="dispatch[yandex_image_finder.search]">
                    {__("yif_find_images")}
                </button>
            </div>
        </div>
    </form>

    {include file="addons/yandex_image_finder/views/yandex_image_finder/components/results.tpl" yif_data=$yif_data}
</div>
