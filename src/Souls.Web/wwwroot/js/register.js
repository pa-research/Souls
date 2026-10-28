(function ($) {
    "use strict";

    function updateCards() {
        var checked = $(".cards:checked").length;
        $(".num-cards-selected").text(checked);
        $(".cards:not(:checked)").prop("disabled", checked >= 5);
    }

    $(".cards").on("change", updateCards);
    updateCards();

    // Show the class portrait when hovering a class.
    $(".race-type").on("mouseover", function () {
        var id = parseInt($(this).data("type-id"), 10);
        $(".class-portrait").css("background-image", "url(/Content/Images/Player/Portraits/" + id + ".png)").show();
    }).on("mouseleave", function () {
        $(".class-portrait").hide();
    });
})(jQuery);
