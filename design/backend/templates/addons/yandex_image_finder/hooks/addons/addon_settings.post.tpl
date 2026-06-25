{if $smarty.request.addon == "yandex_image_finder"}
    <div class="well well-small yif-test-connection">
        <form action="{""|fn_url}"
              method="post"
              name="yif_test_connection_form"
              class="cm-ajax"
              data-ca-target-id="yif_test_connection_result">
            <input type="hidden" name="security_hash" value="{""|fn_generate_security_hash}" />
            <input type="hidden" name="result_ids" value="yif_test_connection_result" />

            <button type="submit"
                    class="btn btn-primary"
                    name="dispatch[yandex_image_finder.test_connection]">
                {__("yif_test_connection")}
            </button>
        </form>
        <div id="yif_test_connection_result" class="yif-test-connection__result"><!--yif_test_connection_result--></div>
    </div>
{/if}
