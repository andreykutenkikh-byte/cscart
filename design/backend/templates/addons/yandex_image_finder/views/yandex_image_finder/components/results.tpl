{assign var="yif_result_id" value="yif_results_`$yif_data.product_id`"}
{assign var="yif_settings" value=$yif_data.settings_summary}

<div id="{$yif_result_id}" class="yif-results">
    {if $yif_data.session}
        <div class="muted yif-session-line">
            #{$yif_data.session.session_id}
            &middot; {$yif_data.session.query|escape}
            &middot; {$yif_data.session.status|escape}
        </div>
    {/if}

    {if $yif_data.candidates}
        <div class="yif-grid">
            {foreach from=$yif_data.candidates item="candidate"}
                <div class="yif-card yif-card--{$candidate.status|escape}">
                    <div class="yif-card__thumb">
                        {if $candidate.thumbnail_url}
                            <img src="{$candidate.thumbnail_url|escape}" alt="" loading="lazy" referrerpolicy="no-referrer" />
                        {else}
                            <span class="muted">{__("no_image")}</span>
                        {/if}
                    </div>

                    <div class="yif-card__meta">
                        <div>
                            <strong>{__("yif_source_domain")}:</strong>
                            {$candidate.source_domain|default:__("no_data")|escape}
                        </div>
                        <div>
                            <strong>{__("size")}:</strong>
                            {if $candidate.width || $candidate.height}
                                {$candidate.width|escape} × {$candidate.height|escape}
                            {else}
                                {__("no_data")}
                            {/if}
                        </div>
                        <div>
                            <strong>MIME:</strong>
                            {$candidate.mime_type|default:__("no_data")|escape}
                        </div>
                        <div>
                            <strong>{__("file_size")}:</strong>
                            {if $candidate.file_size}{$candidate.file_size|escape}{else}{__("no_data")}{/if}
                        </div>
                        <div class="yif-url">
                            <strong>{__("yif_original_url")}:</strong>
                            <span title="{$candidate.image_url|escape}">{$candidate.image_url|escape}</span>
                        </div>
                        <div class="yif-url">
                            <strong>{__("yif_source_page_url")}:</strong>
                            <span title="{$candidate.source_page_url|escape}">{$candidate.source_page_url|escape}</span>
                        </div>
                        {if $candidate.error_message}
                            <div class="text-error">{$candidate.error_message|escape}</div>
                        {/if}
                    </div>

                    <div class="yif-card__actions">
                        {if $candidate.source_page_url}
                            <a class="btn btn-small"
                               href="{$candidate.source_page_url|escape}"
                               target="_blank"
                               rel="noopener noreferrer">
                                {__("yif_open_source")}
                            </a>
                        {/if}

                        {if $candidate.status == "new"}
                            <form action="{""|fn_url}" method="post" class="cm-ajax yif-inline-form" data-ca-target-id="{$yif_result_id}">
                                <input type="hidden" name="security_hash" value="{""|fn_generate_security_hash}" />
                                <input type="hidden" name="result_ids" value="{$yif_result_id}" />
                                <input type="hidden" name="product_id" value="{$yif_data.product_id}" />
                                <input type="hidden" name="session_id" value="{$candidate.session_id}" />
                                <input type="hidden" name="candidate_id" value="{$candidate.candidate_id}" />
                                <button type="submit" class="btn btn-small" name="dispatch[yandex_image_finder.reject]">
                                    {__("yif_reject")}
                                </button>
                            </form>

                            <form action="{""|fn_url}" method="post" class="cm-ajax yif-inline-form" data-ca-target-id="{$yif_result_id}">
                                <input type="hidden" name="security_hash" value="{""|fn_generate_security_hash}" />
                                <input type="hidden" name="result_ids" value="{$yif_result_id}" />
                                <input type="hidden" name="product_id" value="{$yif_data.product_id}" />
                                <input type="hidden" name="session_id" value="{$candidate.session_id}" />
                                <input type="hidden" name="candidate_id" value="{$candidate.candidate_id}" />
                                <input type="hidden" name="import_as" value="additional" />
                                <button type="submit"
                                        class="btn btn-small btn-primary {if $yif_settings.show_rights_warning == "Y"}cm-confirm{/if}"
                                        data-ca-confirm-text="{__("yif_rights_warning")|escape}"
                                        name="dispatch[yandex_image_finder.import]">
                                    {__("yif_upload_additional")}
                                </button>
                            </form>

                            {if $yif_settings.enable_set_main == "Y"}
                                <form action="{""|fn_url}" method="post" class="cm-ajax yif-inline-form" data-ca-target-id="{$yif_result_id}">
                                    <input type="hidden" name="security_hash" value="{""|fn_generate_security_hash}" />
                                    <input type="hidden" name="result_ids" value="{$yif_result_id}" />
                                    <input type="hidden" name="product_id" value="{$yif_data.product_id}" />
                                    <input type="hidden" name="session_id" value="{$candidate.session_id}" />
                                    <input type="hidden" name="candidate_id" value="{$candidate.candidate_id}" />
                                    <input type="hidden" name="import_as" value="main" />
                                    <input type="hidden" name="confirm_main" value="Y" />
                                    <button type="submit"
                                            class="btn btn-small btn-warning cm-confirm"
                                            data-ca-confirm-text="{if $yif_settings.show_rights_warning == "Y"}{__("yif_rights_warning")|escape} {/if}{__("yif_confirm_set_main")|escape}"
                                            name="dispatch[yandex_image_finder.import]">
                                        {__("yif_set_main")}
                                    </button>
                                </form>
                            {/if}
                        {elseif $candidate.status == "imported"}
                            <span class="label label-success">{__("yif_already_imported")}</span>
                        {elseif $candidate.status == "failed"}
                            <span class="label label-important">{__("yif_import_error")}</span>
                        {elseif $candidate.status == "rejected"}
                            <span class="label">{__("yif_reject")}</span>
                        {/if}
                    </div>
                </div>
            {/foreach}
        </div>
    {else}
        <p class="muted">{__("yif_no_candidates")}</p>
    {/if}
<!--{$yif_result_id}--></div>
