(function () {
    "use strict";

    var preview = document.querySelector(".card-container");

    function previewAll(selector) {
        return preview ? preview.querySelectorAll(selector) : [];
    }

    function selectedOption(select) {
        return select.options[select.selectedIndex] || null;
    }

    // Live preview of the card while editing.
    document.querySelectorAll("[data-preview]").forEach(function (input) {
        function update() {
            var option = input.tagName === "SELECT" ? selectedOption(input) : null;
            var value = input.tagName === "SELECT" ? (option ? option.textContent : "") : input.value;
            // --len sizes the name to fit (see _CardTile).
            previewAll(input.dataset.preview).forEach(function (el) {
                el.textContent = value === "" ? "x" : value;
                el.style.setProperty("--len", String(Math.max(1, value.length)));
            });
        }
        input.addEventListener("input", update);
        input.addEventListener("change", update);
    });

    var race = document.getElementById("race-select");
    if (race) {
        var showRace = function () {
            var option = selectedOption(race);
            var texture = option && option.dataset.texture;
            if (texture && preview) {
                preview.style.backgroundImage = "url('" + texture + "')";
            }
        };
        race.addEventListener("change", showRace);
        showRace();
    }

    // Portrait upload: the server validates the image and returns its URL.
    var upload = document.getElementById("portrait-upload");
    if (upload) upload.addEventListener("change", function () {
        var file = this.files[0];
        if (!file) {
            return;
        }

        var data = new FormData();
        data.append("file", file);
        var token = document.querySelector("#card-form input[name='__RequestVerificationToken']");
        // The texts in the page's language are on the status line (data-*).
        var status = document.getElementById("upload-status");
        var texts = status.dataset;
        status.textContent = texts.uploading;

        fetch("/Admin/Upload", { method: "POST", body: data, headers: { "X-CSRF-TOKEN": token ? token.value : "" } })
            .then(function (r) {
                return r.json().then(function (result) { return { ok: r.ok, result: result }; });
            })
            .then(function (response) {
                var result = response.result;
                if (!response.ok) {
                    status.textContent = result && result.error ? result.error : texts.failed;
                    return;
                }
                previewAll(".card-portrait").forEach(function (img) { img.src = result.data; });
                document.getElementById("Card_Portrait").value = result.data;
                status.textContent = texts.uploaded;
            })
            .catch(function () {
                status.textContent = texts.failed;
            });
    });
})();
