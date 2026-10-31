(function ($) {
    "use strict";

    var preview = $(".card-container").first();

    // Live preview of the card while editing.
    $("[data-preview]").on("input change", function () {
        var value = this.tagName === "SELECT" ? $(this).find("option:selected").text() : $(this).val();
        // --len sizes the name to fit (see _CardTile).
        preview.find($(this).data("preview")).text(value === "" ? "x" : value).css("--len", String(Math.max(1, value.length)));
    });

    $("#race-select").on("change", function () {
        var texture = $(this).find("option:selected").data("texture");
        if (texture) {
            preview.css("background-image", "url('" + texture + "')");
        }
    }).trigger("change");

    // Portrait upload: the server validates the image and returns its URL.
    $("#portrait-upload").on("change", function () {
        var file = this.files[0];
        if (!file) {
            return;
        }

        var data = new FormData();
        data.append("file", file);
        var token = $("#card-form input[name='__RequestVerificationToken']").val();
        // The texts in the page's language are on the status line (data-*).
        var status = $("#upload-status");
        var texts = status[0].dataset;
        status.text(texts.uploading);

        $.ajax({
            url: "/Admin/Upload",
            type: "POST",
            data: data,
            processData: false,
            contentType: false,
            headers: { "X-CSRF-TOKEN": token },
            dataType: "json"
        }).done(function (result) {
            preview.find(".card-portrait").css("background-image", "url('" + result.data + "')");
            $("#Card_Portrait").val(result.data);
            status.text(texts.uploaded);
        }).fail(function (xhr) {
            var error = xhr.responseJSON && xhr.responseJSON.error ? xhr.responseJSON.error : texts.failed;
            status.text(error);
        });
    });
})(jQuery);
