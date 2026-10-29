// Registration: count the starter cards and stop at five.
(function ($) {
    "use strict";

    function updateCards() {
        var checked = $(".cards:checked").length;
        $(".num-cards-selected").text(checked);
        $(".cards:not(:checked)").prop("disabled", checked >= 5);
    }

    $(".cards").on("change", updateCards);
    updateCards();
})(jQuery);
