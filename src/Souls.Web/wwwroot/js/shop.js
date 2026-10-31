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
            // The texts in the page's language are on the dialog (data-*).
            var texts = dialog.dataset;
            var text = window.soulsFormat(upgrade ? texts.upgradeText : texts.purchaseText, form.dataset.cardName, form.dataset.price);
            var confirmed = function () {
                form.dataset.confirmed = "true";
                form.submit();
            };

            if (typeof dialog.showModal !== "function") {
                if (window.confirm(text)) {
                    confirmed();
                }
                return;
            }

            document.getElementById("buy-confirm-title").textContent = window.soulsFormat(upgrade ? texts.upgrade : texts.purchase, form.dataset.cardName);
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

    // Filters: rarity, race and "not owned yet".
    var filters = document.getElementById("shop-filters");
    if (filters) {
        var state = { rarity: "", race: "" };
        var unowned = document.getElementById("shop-unowned");
        var shown = document.getElementById("shop-shown");
        var cards = Array.prototype.slice.call(document.querySelectorAll(".s-shop-grid > .s-card-wrap"));
        var apply = function () {
            var count = 0;
            cards.forEach(function (card) {
                var visible = (!state.rarity || card.dataset.rarity === state.rarity)
                    && (!state.race || card.dataset.race === state.race)
                    && (!unowned.checked || card.dataset.owned !== "true");
                card.hidden = !visible;
                if (visible) count++;
            });
            shown.textContent = window.soulsFormat(shown.dataset.text, count, cards.length);
        };
        filters.querySelectorAll("button[data-filter]").forEach(function (button) {
            button.addEventListener("click", function () {
                state[button.dataset.filter] = button.dataset.value;
                button.parentElement.querySelectorAll("button").forEach(function (b) {
                    b.classList.toggle("active", b === button);
                    b.setAttribute("aria-pressed", b === button ? "true" : "false");
                });
                apply();
            });
        });
        unowned.addEventListener("change", apply);
        apply();
    }

    // Card pack: the cards lie face down. Tap (or Enter/Space) turns one over; "Reveal all" turns the rest one by one.
    var packCards = Array.prototype.slice.call(document.querySelectorAll(".s-pack-card"));
    var revealAll = document.getElementById("pack-reveal-all");
    if (packCards.length > 0 && revealAll) {
        var status = document.getElementById("pack-status");
        var hidden = function () {
            return packCards.filter(function (card) { return !card.parentElement.classList.contains("revealed"); });
        };
        var reveal = function (card) {
            if (card.parentElement.classList.contains("revealed")) {
                return;
            }

            card.parentElement.classList.add("revealed");
            card.setAttribute("aria-label", card.dataset.label);
            status.textContent = card.dataset.label;
            revealAll.hidden = hidden().length === 0;
        };
        packCards.forEach(function (card) {
            card.addEventListener("click", function () { reveal(card); });
        });
        revealAll.addEventListener("click", function () {
            var step = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 450;
            hidden().forEach(function (card, i) {
                setTimeout(function () { reveal(card); }, i * step);
            });
            revealAll.hidden = true;
            packCards[0].focus();
        });
    }
})();
