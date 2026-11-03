// Shared page behaviour. Pages contain no inline scripts (strict Content-Security-Policy).
(function () {
    "use strict";

    // A text from the page (data-* attributes, in the page's language) with its {0}, {1}... filled in.
    window.soulsFormat = function (text) {
        var args = arguments;
        return String(text).replace(/\{(\d+)\}/g, function (match, i) { return String(args[Number(i) + 1]); });
    };

    // Forms with data-confirm ask before submitting.
    document.addEventListener("submit", function (e) {
        var form = e.target.closest("form[data-confirm]");
        if (form && !window.confirm(form.dataset.confirm)) {
            e.preventDefault();
        }
    });

    // Hide validation summaries without errors.
    document.querySelectorAll(".empty-hidden").forEach(function (summary) {
        var errors = Array.prototype.some.call(summary.querySelectorAll("li"), function (li) { return li.textContent.trim().length > 0; });
        if (!errors) summary.classList.add("d-none");
    });
})();
