(function ($) {
    "use strict";

    var dialog = $("#buy-confirm");

    $(".buy-form").on("submit", function (e) {
        var form = this;
        if (form.dataset.confirmed === "true") {
            return;
        }

        e.preventDefault();
        $("#buy-confirm-message").text("Are you sure you want to purchase " + form.dataset.cardName + " for " + form.dataset.price + " soul coins?");
        dialog.removeClass("d-none").dialog({
            title: "Purchase " + form.dataset.cardName,
            modal: true,
            buttons: {
                "Purchase": function () {
                    form.dataset.confirmed = "true";
                    $(this).dialog("close");
                    form.submit();
                },
                "Cancel": function () {
                    $(this).dialog("close");
                }
            }
        });
    });
})(jQuery);
