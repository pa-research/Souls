// Shop: asks before spending soul coins.
(function () {
    "use strict";

    var dialog = document.getElementById("buy-confirm");

    document.querySelectorAll(".buy-form").forEach(function (form) {
        form.addEventListener("submit", function (e) {
            if (form.dataset.confirmed === "true") {
                return;
            }

            e.preventDefault();
            var upgrade = form.dataset.upgrade === "true";
            var text = "Are you sure you want to " + (upgrade ? "upgrade " : "purchase ") + form.dataset.cardName + " for " + form.dataset.price + " soul coins?";
            var confirmed = function () {
                form.dataset.confirmed = "true";
                form.submit();
            };

            if (!dialog || typeof dialog.showModal !== "function") {
                if (window.confirm(text)) {
                    confirmed();
                }
                return;
            }

            document.getElementById("buy-confirm-title").textContent = (upgrade ? "Upgrade " : "Purchase ") + form.dataset.cardName;
            document.getElementById("buy-confirm-message").textContent = text;
            dialog.returnValue = "";
            dialog.onclose = function () {
                if (dialog.returnValue === "ok") {
                    confirmed();
                }
            };
            dialog.showModal();
        });
    });
})();
