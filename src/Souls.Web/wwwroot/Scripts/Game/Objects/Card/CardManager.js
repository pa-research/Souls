define("cardmanager", ["cardslot", "conf", "toolbox", "card", "animation"], function (CardSlot, Conf, Toolbox, Card, Animation) {



    CardManager = function (engine, isPlayer) {
        this.engine = engine;
        this.cardSlots = new Object()

        this.hand = new Object();
        this.board = new Object();
        this.isPlayer = isPlayer;


        // The player's hand sits low enough to leave the board free and high enough to show the whole card (stats too).
        this.startCardX = 165;
        this.startCardY = isPlayer ? 965 : 200;

        this.cardSpacing = 60;

        this.handCounter = 0;
        this.placeholderCounter = 0;
    }

    CardManager.prototype.constructor = CardManager;



    CardManager.prototype.SortHand = function () {

        var count = 0;

        for (var index in this.hand) {

            var c = this.hand[index];
            c.order = count;
            c.OrderOriginalPosition();

            c.position.originX = +this.startCardX + (this.cardSpacing * (count++));
            c.y = c.position.originY = this.startCardY;

            this.engine.CreateJS.Tween.get(c)
                .wait(50 * count)
                .to({
                    x: c.position.originX
                }, 700, this.engine.CreateJS.Ease.elasticOut)


        }
        this.handCounter = count;

    }

    CardManager.prototype.HandCount = function () {
        return Object.keys(this.hand).length;
    }


    /// <summary>
    /// Adds a card to the hand
    /// </summary>
    /// <param name="c">The card</param>
    CardManager.prototype.AddCardHand = function (c) {
        this.hand[c.cid] = c;


        // If this is Opponent we want to start the card flipped
        if (!this.isPlayer) {
            c.FlipCard();
        }
    }

    /// <summary>
    /// Adds a card to the board
    /// </summary>
    /// <param name="c">The card</param>
    CardManager.prototype.AddCardBoard = function (c) {
        this.board[c.cid] = c;
    }

    /// <summary>
    /// Function which creates and adds cardsslots to the board
    /// </summary>
    CardManager.prototype.AddCardSlots = function () {

        // Sets the position and set default cardSlot groupname
        var position = { x: (Conf.width / 13), y: 700 }
        var groupName = "CardSlot-Player";

        // If its not a player, it must be a opponent. So set the opponent cardslot group and replace the position
        if (!this.isPlayer) {
            position.y = 420;
            groupName = "CardSlot-Opponent";
        }

        //  Iterate over each of the cardsslots (7)
        for (var i = 0; i < 7; i++) {
            // Create a new Slot and place it in the array (made in constructor)
            this.cardSlots[i] = new CardSlot(520 + position.x * i, position.y, i);

            // Add the cardslot into the group
            this.engine.addChild(groupName, this.cardSlots[i]);
        }

    }

    /// <summary>
    /// This function parses JSON and creates a Card which is placed into the board
    /// </summary>
    /// <param name="jsonCards">JSON object retrieved from GameSerivce's reply from server</param>
    CardManager.prototype.JSONToBoardCards = function (jsonCards) {
        for (var cJson in jsonCards) {
            this.CreateBoardCard(jsonCards[cJson]);
        }
    }

    /// <summary>
    /// Creates a card directly in its slot (game start, summoned token, state sync). Returns the card.
    /// </summary>
    CardManager.prototype.CreateBoardCard = function (json) {
        var slot = this.cardSlots[json.slotId];
        if (!slot) return null;

        var card = this.CreateCard(json, { x: slot.x, y: slot.y, rotation: 0 });
        this.PlaceInSlot(card, slot);
        this.AddCardBoard(card);
        card.RefreshVisuals();
        return card;
    }

    /// Puts a card in a slot without animation.
    CardManager.prototype.PlaceInSlot = function (card, slot) {
        if (card.inSlot && card.inSlot !== slot && card.inSlot.card === card) card.inSlot.Reset();
        slot.card = card;
        card.inSlot = slot;
        card.x = card.position.originX = slot.x;
        card.y = card.position.originY = slot.y;
        if (this.isPlayer) slot.visible = false;
    }

    /// <summary>
    /// Removes a card from the board (it died): frees its slot at once and plays the death animation.
    /// Returns the duration of the animation.
    /// </summary>
    CardManager.prototype.KillCard = function (card) {
        if (!card) return 0;
        card.isDead = true;
        card.interactive = false;
        delete this.board[card.cid];

        if (card.inSlot && card.inSlot.card === card) {
            card.inSlot.Reset();
        }

        // Remember where it was (death curse and haunt start there).
        this.engine.lastCardPos = this.engine.lastCardPos || {};
        this.engine.lastCardPos[card.cid] = { x: card.x, y: card.y, isPlayer: this.isPlayer };

        // Let go of it if the player was aiming with it.
        var player = this.engine.player;
        if (player && player.holdingCard === card) {
            player.holdingCard = undefined;
            player.arrow.Reset();
        }

        return Animation.Card.Death(card);
    }

    /// <summary>
    /// This function parses JSON and creates a Card which is placed into the hand
    /// </summary>
    /// <param name="jsonCards">JSON object retrieved from GameSerivce's reply from server</param>
    /// <param name="conf">a Confiuration array with position</param>
    /// <param name="options">{draw: true} animates the card from the deck, {returned: true} marks a Haunt card</param>
    CardManager.prototype.JSONToHandCards = function (jsonCards, conf, options) {
        options = options || {};
        if (conf) {
            this.startCardX = conf.x;
            this.startCardY = conf.y;
        }

        var created = [];
        var delay = 0;

        // Iterate over cards
        for (var cJson in jsonCards) {
            var json = jsonCards[cJson];
            if (!json || this.hand[json.cid]) continue;

            var position = {
                x: this.startCardX + (this.cardSpacing * (this.handCounter)),
                y: this.startCardY,
                rotation: 0
            };

            // Create a card
            var card = this.CreateCard(json, position, this.handCounter++);

            this.AddCardHand(card);
            created.push(card);

            if (options.draw || options.returned) {
                this.AnimateIntoHand(card, delay, options.returned);
                delay += 180;
            }
        }

        return created;
    }

    /// A new hand card flies in from the deck (or fades in as a ghost when Haunt returns it).
    CardManager.prototype.AnimateIntoHand = function (card, delay, returned) {
        var engine = this.engine;
        var targetX = card.position.originX;
        var targetY = card.position.originY;
        card._reset = true; // keep the hover code from moving it until it arrived

        if (returned) {
            card.x = targetX;
            card.y = targetY + (this.isPlayer ? -140 : 140);
            card.alpha = 0;
            if (card.SetFlash) card.SetFlash(0xb48cff, 1200 + delay);
            engine.CreateJS.Tween.get(card, { override: true })
                .wait(delay)
                .to({ alpha: 1, y: targetY }, 650, engine.CreateJS.Ease.quadOut);
            setTimeout(function () {
                Animation.Fx.Float(engine, card, window.SoulsL10n.t('classic.fx.returned'), "#c9a8ff", 34, this.isPlayer ? -130 : 130);
            }.bind(this), delay + 200);
            return;
        }

        card.x = Conf.width + 120;
        card.y = targetY + (this.isPlayer ? -60 : 60);
        engine.CreateJS.Tween.get(card, { override: true })
            .wait(delay)
            .to({ x: targetX, y: targetY }, 650, engine.CreateJS.Ease.quadOut);
    }

    /// <summary>
    /// Takes a card out of the hand by cid. For the opponent (whose hand is hidden) another card stands in
    /// if the cid is unknown, so a missed message cannot break the game.
    /// </summary>
    CardManager.prototype.TakeHandCard = function (cid) {
        var card = this.hand[cid];
        if (!card && !this.isPlayer) {
            for (var key in this.hand) {
                if (String(key).indexOf('p') === 0) { card = this.hand[key]; delete this.hand[key]; break; }
            }
            if (!card) {
                for (var other in this.hand) { card = this.hand[other]; delete this.hand[other]; break; }
            }
            if (card) card.cid = cid;
        }
        else if (card) {
            delete this.hand[cid];
        }
        return card;
    }

    /// Replaces the whole hand with new cards from the deck (the mulligan gives every card a new cid).
    CardManager.prototype.ReplaceHand = function (jsonCards) {
        for (var key in this.hand) this.RemoveCard(this.hand[key]);
        this.hand = {};
        this.handCounter = 0;
        return this.JSONToHandCards(jsonCards, null, { draw: true });
    }

    /// <summary>
    /// Makes the number of (hidden) opponent hand cards match the server.
    /// </summary>
    CardManager.prototype.SyncHandCount = function (count) {
        if (this.isPlayer || typeof count !== 'number' || count < 0) return;
        var keys = Object.keys(this.hand);
        if (keys.length === count) return;

        while (keys.length > count) {
            var key = keys.pop();
            var card = this.hand[key];
            delete this.hand[key];
            if (card && card.parent) card.parent.removeChild(card);
        }

        var missing = [];
        for (var i = keys.length; i < count; i++) {
            missing.push({ cid: 'p' + (++this.placeholderCounter) });
        }
        if (missing.length) this.JSONToHandCards(missing);
        this.SortHand();
    }

    /// <summary>
    /// Creates a card
    /// </summary>
    /// <param name="jsonCard">Contains the JSON data retrieved from the server</param>
    /// <param name="position">Should contain: X position, Y position and ROTATION</param>
    /// <returns type=""></returns>
    CardManager.prototype.CreateCard = function (jsonCard, position, order) {

        var c = new Card(this.engine, jsonCard, order);
        c.x = c.position.originX = position.x;
        c.y = c.position.originY = position.y;
        c.originRot = position.rotation;

        if (this.isPlayer) {
            c.interactive = true;
            c.owner = this.engine.player;
            this.engine.addChild("Card-Player", c);
        }
        else {
            c.interactive = false;
            c.owner = this.engine.opponent;
            this.engine.addChild("Card-Opponent", c);
        }

        return c;
    }

    CardManager.prototype.Process = function () {

        // Process Card Slots
        for (var index in this.cardSlots) {
            this.cardSlots[index].Process();
        }

        // Process Hand Cards
        for (var cardIndex in this.hand) {
            this.hand[cardIndex].Process();
        }

        // Process Board Cards
        for (var cardIndex in this.board) {
            this.board[cardIndex].Process();
        }
    }

    CardManager.prototype.RemoveCard = function (card) {
        // The card may sit in another group (e.g. "Attacker") or be gone already (removed twice).
        if (card.parent) {
            card.parent.removeChild(card);
        }
        if (this.board[card.cid] === card) delete this.board[card.cid];
    }

    /// Removes every card and slot (used when the game state is sent again).
    CardManager.prototype.Clear = function () {
        var key;
        for (key in this.hand) this.RemoveCard(this.hand[key]);
        for (key in this.board) this.RemoveCard(this.board[key]);
        for (key in this.cardSlots) {
            if (this.cardSlots[key].parent) this.cardSlots[key].parent.removeChild(this.cardSlots[key]);
        }
        this.hand = {};
        this.board = {};
        this.handCounter = 0;
    }

    return CardManager;
});
