// Shared page behaviour. Pages contain no inline scripts (strict Content-Security-Policy).
(function ($) {
    "use strict";

    // A text from the page (data-* attributes, in the page's language) with its {0}, {1}... filled in.
    window.soulsFormat = function (text) {
        var args = arguments;
        return String(text).replace(/\{(\d+)\}/g, function (match, i) { return String(args[Number(i) + 1]); });
    };

    // Forms with data-confirm ask before submitting.
    $(document).on("submit", "form[data-confirm]", function (e) {
        if (!window.confirm($(this).data("confirm"))) {
            e.preventDefault();
        }
    });

    // Hide validation summaries without errors.
    $(".empty-hidden").each(function () {
        if ($(this).find("li").filter(function () { return $(this).text().trim().length > 0; }).length === 0) {
            $(this).addClass("d-none");
        }
    });
})(jQuery);
