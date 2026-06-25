{if $product_data.product_id}
    <div id="content_yandex_image_finder" class="cm-hide-save-button {if $selected_section !== "yandex_image_finder"}hidden{/if}">
        {component name="configurable_page.field" entity="products" tab="yandex_image_finder" section="main" field="finder"}
            {include file="addons/yandex_image_finder/views/yandex_image_finder/product_tab.tpl"
                product_id=$product_data.product_id
                product_data=$product_data
            }
        {/component}
    </div>
{/if}
