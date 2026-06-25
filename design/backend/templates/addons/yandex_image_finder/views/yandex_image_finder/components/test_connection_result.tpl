<div id="yif_test_connection_result" class="yif-test-connection__result">
    {if $yif_test_result.message}
        <span class="{if $yif_test_result.success}text-success{else}text-error{/if}">
            {$yif_test_result.message|escape}
        </span>
    {/if}
<!--yif_test_connection_result--></div>
