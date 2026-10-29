// Deck builder: steppers, the card total, the mana curve and the deck list. Saving is only enabled at exactly the
// deck size (the server validates again).
(function () {
    "use strict";
    var form = document.getElementById("deck-form");
    if (!form) return;
    var size = Number(form.dataset.deckSize);
    var max = Number(form.dataset.maxCopies);
    var total = document.getElementById("deck-total");
    var count = document.getElementById("deck-count");
    var save = document.getElementById("deck-save");
    var curve = document.getElementById("deck-curve");
    var list = document.getElementById("deck-list");
    var cards = Array.prototype.slice.call(form.querySelectorAll(".deck-card"));

    function value(input) {
        return Math.max(0, Math.min(max, Math.floor(Number(input.value) || 0)));
    }

    function update() {
        var sum = 0;
        var buckets = [0, 0, 0, 0, 0, 0, 0, 0];
        var entries = [];
        cards.forEach(function (card) {
            var n = value(card.querySelector(".deck-count"));
            var cost = Number(card.dataset.cost) || 0;
            sum += n;
            buckets[Math.min(7, cost)] += n;
            card.classList.toggle("in-deck", n > 0);
            if (n > 0) entries.push({ name: card.dataset.cardName, cost: cost, n: n });
        });
        total.textContent = String(sum);
        count.classList.toggle("bad", sum !== size);
        save.disabled = sum !== size;

        var top = Math.max(1, Math.max.apply(null, buckets));
        curve.replaceChildren();
        buckets.forEach(function (b) {
            var bar = document.createElement("div");
            bar.className = "s-curve-bar";
            var label = document.createElement("em");
            label.textContent = b ? String(b) : "";
            var fill = document.createElement("span");
            fill.style.height = (b / top * 100) + "%";
            bar.append(label, fill);
            curve.appendChild(bar);
        });

        entries.sort(function (a, b) { return a.cost - b.cost || a.name.localeCompare(b.name); });
        list.replaceChildren();
        entries.forEach(function (e) {
            var li = document.createElement("li");
            var gem = document.createElement("span");
            gem.className = "s-mana";
            gem.textContent = String(e.cost);
            var name = document.createElement("span");
            name.textContent = e.name;
            var n = document.createElement("span");
            n.className = "s-x";
            n.textContent = "×" + e.n;
            li.append(gem, name, n);
            list.appendChild(li);
        });
    }

    cards.forEach(function (card) {
        var input = card.querySelector(".deck-count");
        input.addEventListener("input", update);
        card.querySelector(".deck-minus").addEventListener("click", function () { input.value = String(Math.max(0, value(input) - 1)); update(); });
        card.querySelector(".deck-plus").addEventListener("click", function () { input.value = String(Math.min(max, value(input) + 1)); update(); });
    });
    update();
})();
