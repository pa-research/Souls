define("gameService", ["messages", "asset", "eventPlayer", "animation", "heropower", "mulligan", "card"], function (Message, Asset, EventPlayer, Animation, HeroPower, Mulligan, Card) {

    var that;

    // Where a spell is cast: beside the board, left of the slots, ours a little lower than the opponent's.
    var SPELL_X = 280, SPELL_Y = { player: 610, opponent: 510 };
    var MULLIGAN_FADE = 900; // the mulligan layer fades out (sg-fade-out) before the first turn banner
    GameService = function (engine, socket) {

        that = this;

        this.engine = engine;
        this.socket = this.engine.gameSocket;

        // Create what is needed for the network to work
        this.responseAction = new Object();
        this.networkBuffer = GameService.prototype.networkBuffer = new Array();
        this.message = Message;

        // Messages are handled in order; a handler (or an event step) returns how long its animation needs and
        // the next one waits for it.
        this.steps = [];
        this.blockedUntil = 0;
        this.events = new EventPlayer(engine);

        /// Game
        this.RegisterResponseAction(["11", "12", "13", "14"], Response_NotLoggedIn);
        this.RegisterResponseAction(["10"], Response_LoggedIn);
        this.RegisterResponseAction(["100"], Response_QueueOK);
        this.RegisterResponseAction(["101"], Response_QueueAlreadyIn);
        this.RegisterResponseAction(["206", "220"], Response_GameCreate);
        this.RegisterResponseAction(["209"], Response_GameOpponentMove);
        this.RegisterResponseAction(["210", "212"], Response_GameRelease);
        this.RegisterResponseAction(["207", "211"], Response_UseCard);
        this.RegisterResponseAction(["224", "225"], Response_UseSpell);
        this.RegisterResponseAction(["202"], Repsonse_NotYourTurn);
        this.RegisterResponseAction(["213"], Response_SlotOccupied);
        this.RegisterResponseAction(["226"], Response_NextTurn);
        this.RegisterResponseAction(["222", "223"], Response_NewCard);
        this.RegisterResponseAction(["227", "228"], Response_Mulligan);
        this.RegisterResponseAction(["208"], Response_UseCard_OOM);
        this.RegisterResponseAction(["230", "231", "233"], Response_VictoryDefeat);
        this.RegisterResponseAction(["232"], Response_GeneralMessage);
        this.RegisterResponseAction(["235"], Response_GameEvents);
        this.RegisterResponseAction(["236"], Response_GameSync);
        this.RegisterResponseAction(["240", "241", "242"], Response_Spectate);
        this.RegisterResponseAction(["243"], Response_SpectateError);
        this.RegisterResponseAction(["197", "198", "199"], Response_Challenge);
        this.RegisterResponseAction(["299"], Response_Emote);

        // Feedback on the player's own requests, the opponent's card dragging, challenges and emotes are shown at
        // once instead of waiting behind the animations.
        this.immediate = { 197: true, 198: true, 199: true, 202: true, 208: true, 209: true, 213: true, 232: true, 243: true, 299: true };
    }
    // Constructor
    GameService.prototype.constructor = GameService;


    //////////////////////////////////////////////////////////////////////////////
    //////////////////////////////////////////////////////////////////////////////
    ///////////////////////GAME-RESPONSES/////////////////////////////////////////
    //////////////////////////////////////////////////////////////////////////////
    //////////////////////////////////////////////////////////////////////////////

    function Text(payload, fallback) {
        if (typeof payload === 'string') return payload;
        if (payload && typeof payload.error === 'string') return payload.error;
        if (payload && typeof payload.message === 'string') return payload.message;
        return fallback;
    }

    /// How long a message waited in the queue (behind animations) since it arrived.
    function Age(json) {
        return json.receivedAt ? Math.max(0, Date.now() - json.receivedAt) : 0;
    }

    function ClearPendingPower() {
        var player = that.engine.player;
        if (player && player.heroPower && player.heroPower.pending) {
            player.heroPower.pending = false;
            player.heroPower.Redraw();
        }
    }

    function Response_UseCard_OOM(json) {
        ClearPendingPower();
        that.engine.ScreenMessage([Text(json.Payload, "Not enough mana!")], false);
        return 0;
    }

    function Response_GeneralMessage(json) {
        ClearPendingPower();
        that.engine.ScreenMessage([Text(json.Payload, "")], false);
        return 0;
    }

    function Response_SpectateError(json) {
        that.engine.ScreenMessage([Text(json.Payload, "Cannot watch that game.")], false);
        return 0;
    }

    function Response_Spectate(json) {
        // Spectating is offered by the 3D client; the classic client only plays.
        return 0;
    }

    /// 199 ChallengeInvite {name, type, rating, expiresIn}, 198 ChallengeSent {name}, 197 ChallengeClosed (string).
    function Response_Challenge(json) {
        var queue = that.engine.queue;
        if (json.Type == 199) {
            queue.ShowInvite(json.Payload || {});
        }
        else if (json.Type == 198) {
            queue.ChallengeWaiting(json.Payload && json.Payload.name);
        }
        else {
            queue.HideInvite();
            queue.ChallengeIdle(Text(json.Payload, ""));
        }
        return 0;
    }

    /// 299 Emote {ident, emote, text}
    function Response_Emote(json) {
        that.engine.emotes.Say(json.Payload || {});
        return 0;
    }

    /// 222 NewCard (ours) / 223 OpponentNewCard: cards drawn, or a Haunt card returned (returned: true).
    function Response_NewCard(json) {
        var engine = that.engine;
        if (!engine.player) return 0;
        var payload = json.Payload || {};
        var cards = payload.card || [];
        var returned = !!payload.returned;
        var hero = (json.Type == 222) ? engine.player : engine.opponent;

        var created = hero.cardManager.JSONToHandCards(cards, null, { draw: !returned, returned: returned });
        hero.handCount = hero.cardManager.HandCount();
        hero.RefreshHud();
        if (created.length === 0) return 0;
        Animation.PlaySound(Asset.Sound.CARD_DRAW, hero === engine.player ? 0.55 : 0.35);
        return 420 + 160 * (created.length - 1);
    }

    /// 227 Mulligan (our starting hand) / 228 OpponentMulligan: the whole hand is new (every card has a new cid).
    function Response_Mulligan(json) {
        var engine = that.engine;
        if (!engine.player) return 0;
        var payload = json.Payload || {};
        var hero = (json.Type == 227) ? engine.player : engine.opponent;
        if (hero === engine.player) Animation.PlaySound(Asset.Sound.CARD_SHUFFLE, 0.8);
        hero.cardManager.ReplaceHand(payload.hand || []);
        hero.handCount = hero.cardManager.HandCount();
        hero.RefreshHud();
        if (engine.mulligan) engine.mulligan.Chosen(hero === engine.player, payload.hand || [], Number(payload.replaced) || 0);
        // A moment to see the new cards before the first turn closes the mulligan screen.
        return hero === engine.player ? 1200 : 300;
    }

    function CloseMulligan(engine) {
        if (!engine.mulligan) return false;
        engine.mulligan.Close();
        engine.mulligan = null;
        return true;
    }

    /// 230 Victory / 231 Defeat / 233 Draw: {statistics, text, coins, rating, ratingChange, quests}
    function Response_VictoryDefeat(json)
    {
        var type = json.Type;
        var payload = json.Payload || {};
        var engine = that.engine;

        CloseMulligan(engine);
        engine.OnEnd();
        if (window.SoulsGameMode) window.SoulsGameMode.clearInGame();

        var title = type == 230 ? "Victory!" : type == 231 ? "Defeat!" : "Draw!";
        Asset.StopMusic();
        if (type != 233) Animation.PlaySound(type == 230 ? Asset.Sound.VICTORY : Asset.Sound.DEFEAT, 0.9);
        if (engine.battleLog) engine.battleLog.Add(title, "system");
        engine.queue.FadeInGameEnd(title, payload.statistics, payload);
        return 0;
    }

    function Response_NotLoggedIn(json) {

        var type = json.Type;

        //"11", "12", "13", "14"
        if (type == 11 || type == 13) {
            that.engine.queue.SetError("You are not logged in!");
        }
        else if (type == 12) {
            that.engine.queue.SetError("Authentication Failure!");
        }
        else if (type == 14) // LOGIN_BANNED
        {
            that.engine.queue.SetError("You are banned!");
        }
        return 0;
    }

    function Response_LoggedIn() {
        that.reconnects = 0;
        that.engine.chatService.Login();
        that.engine.queue.Connected();
        return 0;
    }

    function Response_QueueOK() // 100
    {
        that.engine.queue.Queued();
        return 0;
    }

    function Response_QueueAlreadyIn(json) // 101
    {
        that.engine.queue.SetText(Text(json.Payload, "You are already in queue!"));
        return 0;
    }

    function Response_SlotOccupied(json) // 213 GAME_SLOTOCCUPIED
    {
        that.engine.ScreenMessage([Text(json.Payload, "Slot is already occupied!")], false);
        return 0;
    }

    /// 207 UseCardOk (our card) / 211 OpponentUseCardOk: {card, pInfo}. The card moves from the hand to its slot.
    function Response_UseCard(json)
    {
        var engine = that.engine;
        if (!engine.player) return 0;
        var payload = json.Payload || {};
        var cardData = payload.card;
        if (!cardData) return 0;

        var hero = (json.Type == 211) ? engine.opponent : engine.player;
        var manager = hero.cardManager;
        hero.SetText(payload.pInfo);

        var slot = manager.cardSlots[cardData.slotId];
        if (!slot) return 0;
        var card = manager.TakeHandCard(cardData.cid);
        manager.SortHand();
        hero.handCount = manager.HandCount();
        hero.RefreshHud();

        if (!card) {
            // Not in the hand (a missed message): it simply appears in its slot.
            if (manager.board[cardData.cid]) return 0;
            card = manager.CreateBoardCard(cardData);
            if (card) Animation.Card.Appear(card);
            return 500 + RareEntrance(cardData, slot, hero === engine.opponent, 300);
        }

        card.canAct = false;
        card.playedOnTurn = engine.turnNumber; // summoning sick (tooltip)
        card.UpdateFromJson(cardData);
        card.ScaleDown();
        card.alpha = 1;
        manager.AddCardBoard(card);
        if (hero === engine.player && hero.holdingCard === card) hero.holdingCard = undefined;
        card.PutInSlot(slot);
        return 650 + RareEntrance(cardData, slot, hero === engine.opponent, 450);
    }

    /// <summary>
    /// 224 UseCardSpell (ours) / 225 OpponentUseCardSpell: {card, pInfo, target}. The spell leaves the hand (the
    /// opponent's is revealed) and is cast beside the board. The events that follow come from it (EventPlayer finds
    /// it by cid in engine.castSpells); the next GameSync uses it up.
    /// </summary>
    function Response_UseSpell(json) {
        var engine = that.engine;
        if (!engine.player) return 0;
        var payload = json.Payload || {};
        var cardData = payload.card;
        if (!cardData) return 0;

        var hero = (json.Type == 225) ? engine.opponent : engine.player;
        var manager = hero.cardManager;
        hero.SetText(payload.pInfo);
        var card = manager.TakeHandCard(cardData.cid)
            || manager.CreateCard(cardData, { x: SPELL_X, y: hero === engine.player ? 980 : 200, rotation: 0 });
        manager.SortHand();
        hero.handCount = manager.HandCount();
        hero.RefreshHud();

        if (card._armed) card.Disarm(false);
        if (hero === engine.player && hero.holdingCard === card) hero.holdingCard = undefined;
        card.interactive = false;
        card._awaitRequest = false;
        card.pickedUp = card.dragging = false;
        card.UpdateFromJson(cardData);
        if (card.cardFlipped) card.FlipCard();
        engine.SwapFromToGroup(card, null, "Card-Focus");
        engine.castSpells[card.cid] = card;
        var y = hero === engine.player ? SPELL_Y.player : SPELL_Y.opponent;
        return Animation.Fx.CastSpell(engine, card, SPELL_X, y, Card.ABILITY_COLOR[card.abilityId]);
    }

    /// <summary>
    /// Epic and legendary cards make an entrance when they land (after landAfter ms): legendary cards with a golden
    /// flash and their name in a "Legendary" banner, epic cards with a smaller violet flash. Returns the extra time
    /// the next message waits.
    /// </summary>
    function RareEntrance(cardData, slot, enemy, landAfter) {
        var engine = that.engine;
        var rarity = Number(cardData.rarity) || 0;
        if (rarity < 3 || cardData.token) return 0;
        var legendary = rarity === 4;
        Animation.PlaySound(legendary ? Asset.Sound.LEGENDARY : Asset.Sound.INSIGHT, legendary ? 0.85 : 0.5);
        if (legendary) engine.hud.Legendary(String(cardData.name === undefined || cardData.name === null ? '' : cardData.name), enemy);
        setTimeout(function () {
            if (engine.ended) return;
            engine.hud.Flash(legendary ? 'legendary' : 'epic', slot.x, slot.y);
            Animation.Fx.RareEntrance(engine, slot.x, slot.y, legendary);
        }, landAfter);
        return legendary ? 650 : 250;
    }

    /// Clears the board when the game state is sent again (reconnect).
    function ResetGame(engine) {
        if (!engine.player) return;
        engine.ClearBoard();
    }

    /// 206 GameCreate (also 220): the whole game from our side.
    function Response_GameCreate(data) // 206 CREATE // 220 RECOVER
    {
        var engine = that.engine;
        var payload = data.Payload || {};
        ResetGame(engine);
        CloseMulligan(engine);

        try { Asset.PlayMusic(Asset.Music.GAME, 0.4); } catch (e) { /* sound is optional */ }
        if (payload.create) Animation.PlaySound(Asset.Sound.VERSUS, 0.8);

        engine.myIdent = Number(payload.ident) || 1;
        engine.myTurn = !!payload.yourTurn;
        engine.ended = false;

        // Create the Player and Opponent
        engine.player = new Player(engine);
        engine.opponent = new Opponent(engine);
        engine.ProcessList.push(engine.player);

        engine.gameId = payload.gameId;
        engine.player.playerNr = payload.ident;
        engine.player.SetText(payload.player && payload.player.info);
        engine.opponent.SetText(payload.opponent && payload.opponent.info);

        // Hero power buttons next to the heroes (DOM, over the canvas): ours can be used, the opponent's is shown
        engine.player.heroPower = new HeroPower(engine, engine.player, true);
        engine.player.heroPower.SetPosition(engine.player.GetHome().x + 225, engine.player.GetHome().y - 25);
        engine.player.heroPower.SetType(engine.player.power);

        engine.opponent.heroPower = new HeroPower(engine, engine.opponent, false);
        engine.opponent.heroPower.SetPosition(engine.opponent.GetHome().x + 225, engine.opponent.GetHome().y - 5);
        engine.opponent.heroPower.SetType(engine.opponent.power);

        // Give cards to hand
        engine.player.cardManager.JSONToHandCards(payload.player && payload.player.hand, { x: 165, y: 965 });
        engine.opponent.cardManager.JSONToHandCards(payload.opponent && payload.opponent.hand, { x: 165, y: 200 });

        engine.player.cardManager.JSONToBoardCards(payload.player && payload.player.board);
        engine.opponent.cardManager.JSONToBoardCards(payload.opponent && payload.opponent.board);


        // Create Chat room (If you are player 1)
        if (payload.ident == 1 && payload.create) {
            engine.chatService.RequestNewGameRoom();
        }


        engine.background.endTurnButton.SetPlayerTurn(engine.myTurn);

        // Set Group Visibility to visible
        engine.getGroup("Player").visible = true;
        engine.getGroup("Opponent").visible = true;
        engine.getGroup("EndTurn").visible = true;
        engine.getGroup("Card-Opponent").visible = true;
        engine.getGroup("Card-Player").visible = true;

        if (engine.battleLog) {
            engine.battleLog.SetNames(engine.player.name, engine.opponent.name);
            engine.battleLog.Show();
        }
        if (engine.settings) engine.settings.Show();
        engine.emotes.Show();
        engine.RefreshAll();

        // Fade out the Queue overlay
        engine.queue.FadeOut();

        // Before the first turn: pick the starting cards to replace (once).
        if (payload.mulligan) {
            engine.mulligan = new Mulligan(payload.player && payload.player.hand ? Object.values(payload.player.hand) : [], payload.mulligan,
                engine.opponent.name, function (replace) {
                    that.socket.send({ "Type": Message.Type.Game.MULLIGAN, "Payload": { "replace": replace } });
                });
        }

        // Lets the page resume this game after switching to the 3D client.
        if (window.SoulsGameMode) window.SoulsGameMode.markInGame(engine.normalGame);
        return 300;
    }

    function Response_GameOpponentMove(json) {
        var engine = that.engine;
        if (!engine.opponent || !json.Payload) return 0;
        var card = engine.opponent.cardManager.hand[json.Payload.cid];
        var x = Number(json.Payload.x), y = Number(json.Payload.y);
        if (!card || !isFinite(x) || !isFinite(y)) return 0;

        engine.CreateJS.Tween.get(card, { override: true })
            .to({ x: x, y: y }, 1000, engine.CreateJS.Ease.linear);
        return 0;
    }

    function Response_GameRelease(json) // 210 GAME_OPPONENT_RELEASE // 212 GAME_PLAYER_RELEASE
    {
        var engine = that.engine;
        if (!engine.player || !json.Payload) return 0;
        var manager = json.Type == 210 ? engine.opponent.cardManager : engine.player.cardManager;
        var card = manager.hand[json.Payload.cid];
        if (card) card.Animation.MoveBack(card);
        return 0;
    }

    function Repsonse_NotYourTurn(json) // 202 NOT YOUR TURN
    {
        ClearPendingPower();
        that.engine.ScreenMessage(["Not your turn!"], false);
        return 0;
    }

    /// 226 NextTurn: {yourTurn, playerInfo, opponentInfo, turnEndsIn}
    function Response_NextTurn(json) // 226 NEXT TURN
    {
        var engine = that.engine;
        if (!engine.player) return 0;
        var payload = json.Payload || {};
        engine.myTurn = !!payload.yourTurn;
        // The first turn starts after the mulligan (its turn number is already right).
        var firstTurn = CloseMulligan(engine);

        var button = engine.background.endTurnButton;
        if (engine.myTurn) Animation.PlaySound(Asset.Sound.TURN_START, 0.7);
        if (button.spinning || button.active !== engine.myTurn) button.Spin(engine.myTurn);
        else button.SetPlayerTurn(engine.myTurn);

        // Update player and opponent portrait
        engine.opponent.SetText(payload.opponentInfo);
        engine.player.SetText(payload.playerInfo);

        if (payload.turnEndsIn !== undefined && payload.turnEndsIn !== null) {
            engine.turnTimer.Set(payload.turnEndsIn - Age(json), null, engine.myTurn);
        }

        // The turn number: GameSync sends it (0 for the first turn); the next sync confirms it.
        if (typeof engine.turnNumber === 'number' && !firstTurn) engine.turnNumber++;
        engine.RefreshAll();
        var sub = typeof engine.turnNumber === 'number' ? "Turn " + (engine.turnNumber + 1) : null;
        var mine = engine.myTurn;
        var banner = function () { if (!engine.ended) engine.hud.Banner(mine ? "Your turn" : "Enemy turn", sub, !mine); };
        // The first turn: once the mulligan screen has faded out (0.9 s), not over its cards.
        if (firstTurn && !engine.hud.ReducedMotion()) {
            setTimeout(banner, MULLIGAN_FADE);
            return MULLIGAN_FADE + 750;
        }
        banner();
        return 750;
    }

    /// 235 GameEvents: {events: [...]} - played one after another.
    function Response_GameEvents(json) {
        var events = json.Payload && json.Payload.events;
        var steps = that.events.Expand(events);
        for (var i = 0; i < steps.length; i++) that.steps.push(steps[i]);
        return 0;
    }

    /// 236 GameSync: the full public state, the truth for every number.
    function Response_GameSync(json) {
        var engine = that.engine;
        var state = json.Payload;
        if (!state || !engine.player) return 0;

        // The spells cast in this action are used up (their events have played).
        for (var cid in engine.castSpells) {
            var spell = engine.castSpells[cid];
            Animation.Card.Spend(spell, Card.ABILITY_COLOR[spell.abilityId]);
        }
        engine.castSpells = {};

        engine.myTurn = Number(state.current) === Number(engine.myIdent);
        if (typeof state.turn === 'number') engine.turnNumber = state.turn;

        var heroes = state.heroes || {};
        for (var ident in heroes) {
            var hero = that.events.Hero(ident);
            var info = heroes[ident];
            if (!hero || !info) continue;
            hero.SetText(info);
            if (hero.heroPower) {
                hero.heroPower.SetType(hero.power);
                hero.heroPower.SetState(info.canUsePower, info.heroPowerUsed);
            }
            if (hero === engine.opponent && typeof info.hand === 'number') {
                hero.cardManager.SyncHandCount(info.hand);
            }
        }

        var board = state.board || {};
        for (var side in board) {
            var owner = that.events.Hero(side);
            if (owner) ApplyBoard(owner, board[side] || []);
        }

        if (Number(state.current) === 0) {
            engine.turnTimer.Stop(); // the mulligan has its own countdown
        }
        else if (state.turnEndsIn !== undefined && state.turnEndsIn !== null) {
            engine.turnTimer.Set(state.turnEndsIn - Age(json), state.turnTime, engine.myTurn);
        }

        var button = engine.background.endTurnButton;
        if (!button.spinning && button.active !== engine.myTurn) button.SetPlayerTurn(engine.myTurn);

        engine.RefreshAll();
        return 0;
    }

    /// Makes a board match the server: updates known cards, adds missing ones and removes the others.
    function ApplyBoard(owner, cards) {
        var manager = owner.cardManager;
        var seen = {};

        for (var i = 0; i < cards.length; i++) {
            var json = cards[i];
            if (!json || json.cid === undefined) continue;
            seen[json.cid] = true;
            var slot = manager.cardSlots[json.slotId];
            var card = manager.board[json.cid];

            if (!card) {
                card = manager.hand[json.cid];
                if (card && slot) {
                    // Still in the hand (we missed UseCardOk)
                    delete manager.hand[json.cid];
                    manager.AddCardBoard(card);
                    card.UpdateFromJson(json);
                    card.PutInSlot(slot);
                    manager.SortHand();
                    continue;
                }
                card = manager.CreateBoardCard(json);
                if (card) Animation.Card.Appear(card);
                continue;
            }

            card.UpdateFromJson(json);
            if (slot && card.inSlot !== slot && !card.pickedUp && !card._lunging) {
                manager.PlaceInSlot(card, slot);
            }
        }

        for (var cid in manager.board) {
            if (!seen[cid]) manager.KillCard(manager.board[cid]);
        }
    }


    //////////////////////////////////////////////////////////////////////////////
    //////////////////////////////////////////////////////////////////////////////
    ////////////////////////////REQUESTS//////////////////////////////////////////
    //////////////////////////////////////////////////////////////////////////////
    //////////////////////////////////////////////////////////////////////////////



    GameService.prototype.Login = function () {
        this.socket.send(this.message.GENERAL.LOGIN);

        // Back after a lost connection during a game: any queue request sends the running game again.
        if (this.engine.player && !this.engine.ended) {
            this.socket.send({ "Type": this.engine.normalGame ? Message.Type.Game.NORMAL_QUEUE : Message.Type.Game.PRACTICE_QUEUE, "Payload": {} });
            return;
        }

        // Friendly: wait to be challenged, or challenge the player named in the link
        if (this.engine.friendly) {
            if (this.engine.friendly.challenge) this.Challenge(this.engine.friendly.challenge);
            return;
        }

        // Normal (ranked) game, or practice against the bot with the chosen difficulty
        if (this.engine.normalGame) {
            this.socket.send({ "Type": Message.Type.Game.NORMAL_QUEUE, "Payload": {} });
        }
        else {
            var difficulty = Number(this.engine.difficulty);
            if (!(difficulty >= 0 && difficulty <= 2)) difficulty = 1;
            this.socket.send({ "Type": Message.Type.Game.PRACTICE_QUEUE, "Payload": { "difficulty": difficulty } });
        }
    }

    /// Friendly challenges: invite a player by name, withdraw the invitation, answer one.
    GameService.prototype.Challenge = function (name) {
        this.socket.send({ "Type": Message.Type.Game.CHALLENGE, "Payload": { "name": String(name) } });
    }

    GameService.prototype.CancelChallenge = function () {
        this.socket.send({ "Type": Message.Type.Game.CHALLENGE_CANCEL, "Payload": {} });
    }

    GameService.prototype.AnswerChallenge = function (accept) {
        if (accept) this.engine.friendlyGame = true;
        this.socket.send({ "Type": Message.Type.Game.CHALLENGE_ANSWER, "Payload": { "accept": !!accept } });
    }

    /// <summary>
    /// Uses the ability of a board card. type: 0 friendly card, 1 own hero, 2 enemy hero, 3 enemy card.
    /// </summary>
    GameService.prototype.Request_Ability = function (source, target, type) {
        type = Number(type);
        if (!source || !(type >= 0 && type <= 3)) return;

        this.socket.send({
            "Type": Message.Type.Game.USE_ABILITY,
            "Payload": {
                "source": source.cid,
                "target": (type === 0 || type === 3) && target ? target.cid : -1,
                "type": type
            }
        });
    }

    /// <summary>
    /// Uses the hero power. type: as Request_Ability; a power without a target is sent as (-1, 1).
    /// </summary>
    GameService.prototype.Request_HeroPower = function (targetCid, type) {
        type = Number(type);
        if (!(type >= 0 && type <= 3)) type = 1;
        this.socket.send({
            "Type": Message.Type.Game.HERO_POWER,
            "Payload": {
                "target": (type === 0 || type === 3) ? targetCid : -1,
                "type": type
            }
        });
    }

    GameService.prototype.Request_UseCard = function (card) {
        // If the card is hovering a slot AND that its NOT in a slot
        if (!!card.hoverSlot && !card.inSlot) {
            // The card waits over the slot for the answer (UseCardOk, or Release when it was refused).
            card._awaitRequest = true;
            this.socket.send({
                "Type": Message.Type.Game.USECARD,
                "Payload": { "cid": card.cid, "slotId": card.hoverSlot.slotId }
            });

            // Guard: never leave the card stuck if no answer comes.
            setTimeout(function () {
                if (card._awaitRequest && !card.inSlot && !card.pickedUp && !card.isDead) card.Animation.MoveBack(card);
            }, 5000);
        }
    }

    /// <summary>
    /// Casts a spell from the hand (UseCard): on a target (type as Request_Ability) or, without a type, on nothing.
    /// The card waits for the cast (224) or the Release (212) when the server refuses it.
    /// </summary>
    GameService.prototype.Request_Spell = function (card, type, targetCid) {
        var payload = { "cid": card.cid };
        if (type !== undefined) {
            payload.type = type;
            payload.target = targetCid;
        }
        card._awaitRequest = true;
        this.socket.send({ "Type": Message.Type.Game.USECARD, "Payload": payload });

        // Guard: never leave the card stuck if no answer comes (the cast clears _awaitRequest).
        setTimeout(function () {
            if (card._awaitRequest && !card.pickedUp && !card.isDead) card.Animation.MoveBack(card);
        }, 5000);
    }

    /// <summary>
    /// Sends an attack. type: 0 card on card, 1 card on hero, 2 hero on card, 3 hero on hero.
    /// </summary>
    GameService.prototype.Request_Attack = function (source, target, type) {
        var payload = { "source": -1, "target": -1, "type": type };

        if (type == 0) { payload.source = source.cid; payload.target = target.cid; }
        else if (type == 1) { payload.source = source.cid; }
        else if (type == 2) { payload.target = target.cid; }
        else if (type != 3) { return; }

        this.socket.send({ "Type": Message.Type.Game.ATTACK, "Payload": payload });
    };

    /// <summary>
    /// Request a move action to the server.
    /// </summary>
    GameService.prototype.RequestMove = function (card) {
        this.engine.gameSocket.send({
            "Type": Message.Type.Game.MOVE_CARD,
            "Payload": {
                "x": card.x,
                "y": this.engine.conf.height - card.y + (card.height / 4),
                "cid": card.cid,
                "gameId": this.engine.gameId
            }
        });
    }

    /// <summary>
    /// Requests a card release.
    /// </summary>
    GameService.prototype.RequestRelease = function (card) {
        // If the card is not in a slot AND it is not hovering a slot
        if (!card.inSlot && !card.hoverSlot) {
            card._awaitRequest = true; // Waiting for the response from the server
            this.engine.gameSocket.send({
                "Type": Message.Type.Game.RELEASE_CARD,
                "Payload": { "cid": card.cid, "gameId": this.engine.gameId }
            });

            // Guard: never leave the card stuck if no answer comes.
            setTimeout(function () {
                if (card._awaitRequest && !card.inSlot && !card.pickedUp && !card.isDead) card.Animation.MoveBack(card);
            }, 5000);
        }
    }

    ////////////////////////////////////////////////////////////////
    ////////////////////////////////////////////////////////////////
    ////////////////////////////////////////////////////////////////
    // Message queue
    ////////////////////////////////////////////////////////////////
    GameService.prototype.RegisterResponseAction = function (responseArray, func) {
        for (var response in responseArray) {
            this.responseAction[responseArray[response]] = func;
        }
    }

    GameService.prototype.GetResponseAction = function (responseId) {
        return this.responseAction[responseId];
    }

    /// Runs a message handler; returns the ms its animation needs.
    GameService.prototype.Dispatch = function (packet) {
        var action = this.GetResponseAction(packet.Type);
        if (!action) return 0;
        try {
            var ms = action(packet);
            return typeof ms === 'number' && ms > 0 ? ms : 0;
        }
        catch (e) {
            console.error("[GAME] Failed to handle message " + packet.Type, e);
            return 0;
        }
    }

    GameService.prototype.RunStep = function (step) {
        try {
            var ms = step();
            return typeof ms === 'number' && ms > 0 ? ms : 0;
        }
        catch (e) {
            console.error("[GAME] Failed to play an event", e);
            return 0;
        }
    }

    /// Shortens the waits when messages pile up (e.g. the tab was in the background), so the game catches up.
    GameService.prototype.Pace = function (ms) {
        if (!(ms > 0)) return 0;
        if (document.hidden) return 0;
        var backlog = GameService.prototype.networkBuffer.length + this.steps.length / 2;
        if (backlog > 25) return 0;
        if (backlog > 14) return ms * 0.35;
        if (backlog > 8) return ms * 0.7;
        return Math.min(ms, 4000);
    }

    /// Called every frame: handles messages and event steps in order, waiting for each animation.
    GameService.prototype.Process = function () {
        var buffer = GameService.prototype.networkBuffer;
        for (var guard = 0; guard < 80; guard++) {
            if (Date.now() < this.blockedUntil) return;

            var ms;
            if (this.steps.length > 0) {
                ms = this.RunStep(this.steps.shift());
            }
            else if (buffer.length > 0) {
                ms = this.Dispatch(buffer.shift());
            }
            else {
                return;
            }

            ms = this.Pace(ms);
            if (ms > 0) {
                this.blockedUntil = Date.now() + ms;
                return;
            }
        }
    }

    GameService.prototype.Send = function (json) {
        this.socket.send(json);
    }

    GameService.prototype.Connect = function () {
        var self = this;
        this.socket.connect();

        // Recieves all Data from server
        this.socket.onMessage(function (event) { self.TrafficHandler(event); });
        this.socket.con.onclose = function (event) { self.Reconnect(event); };
    }

    /// The connection dropped (or the server restarts: running games survive it). Reconnects for about a minute,
    /// then logs in again; in a game the server sends the game again (206) and the board is rebuilt.
    GameService.prototype.Reconnect = function (event) {
        var self = this, engine = this.engine;
        var reason = (event && event.reason) || '';
        if (engine.ended || /another window/i.test(reason)) return;
        this.reconnects = (this.reconnects || 0) + 1;
        if (this.reconnects > 12) {
            engine.ScreenMessage(['Connection lost. Reload the page to continue.']);
            return;
        }
        engine.ScreenMessage([/restarting/i.test(reason) ? 'The server is restarting, reconnecting…' : 'Connection lost, reconnecting…'], 'info');
        setTimeout(function () {
            if (engine.ended) return;
            self.Connect();
            var chat = engine.chatSocket.con;
            if (!chat || chat.readyState > 1) engine.chatService.Connect();
            self.Login();
        }, Math.min(1500 * this.reconnects, 5000));
    }


    GameService.prototype.TrafficHandler = function (event) {
        var json;
        try {
            json = JSON.parse(event.data);
        }
        catch (e) {
            return;
        }
        if (!json || typeof json.Type !== 'number') return;
        json.receivedAt = Date.now();

        if (this.immediate && this.immediate[json.Type]) {
            this.Dispatch(json);
            return;
        }
        GameService.prototype.networkBuffer.push(json);
    }

    return GameService;
});
