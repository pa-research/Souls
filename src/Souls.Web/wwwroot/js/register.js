// Registration: count the starter cards and stop at five.
(function () {
    "use strict";

    var cards = document.querySelectorAll(".cards");

    function updateCards() {
        var checked = document.querySelectorAll(".cards:checked").length;
        document.querySelectorAll(".num-cards-selected").forEach(function (el) { el.textContent = checked; });
        cards.forEach(function (box) { if (!box.checked) box.disabled = checked >= 5; });
    }

    cards.forEach(function (box) { box.addEventListener("change", updateCards); });
    updateCards();
})();
