{if $id|default:0}
    <div class="control-group yif-image-block-panel">
        <label class="control-label"></label>
        <div class="controls">
            {include file="addons/yandex_image_finder/views/yandex_image_finder/product_tab.tpl"
                product_id=$id
                product_data=$product_data
                yif_context="inline"
                yif_compact=true
            }
        </div>
    </div>
{/if}
