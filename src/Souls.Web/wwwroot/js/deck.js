// Deck builder: keeps the card total up to date and only enables saving at exactly the deck size.
(function () {
    'use strict';
    var form = document.getElementById('deck-form');
    if (!form) return;
    var size = Number(form.dataset.deckSize);
    var total = document.getElementById('deck-total');
    var save = document.getElementById('deck-save');
    var inputs = form.querySelectorAll('.deck-count');

    function update() {
        var sum = 0;
        inputs.forEach(function (input) { sum += Math.max(0, Number(input.value) || 0); });
        total.textContent = String(sum);
        total.parentElement.classList.toggle('text-danger', sum !== size);
        save.disabled = sum !== size;
    }

    inputs.forEach(function (input) { input.addEventListener('input', update); });
    update();
})();
