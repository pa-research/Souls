// Matchmaking and the end of the game, as DOM layers over the canvas (shared components from css/game-hud.css).
// While queueing, the classic backdrop stays on the canvas under a panel with spinning rings, the status, the time
// waited, the mode (and rank) and a Cancel button. The end screen shows the result, the coins and rating earned,
// the season rank before and after a ranked game (a friendly game earns nothing), the daily quests, links to the statistics and the replay, and moves on to the statistics after 25 seconds.
// Server strings are always set as text.
define("queue", ["asset", "pixi", "hud", "conf"], function (Asset, Pixi, Hud, Conf) {

    var L10n = window.SoulsL10n;
    var T = L10n.t;
    var DIFFICULTY_NAMES = [T('classic.difficulty.easy'), T('classic.difficulty.normal'), T('classic.difficulty.hard')];
    var REDIRECT_SECONDS = 25;

    Queue = function (engine, resuming) {
        Pixi.Sprite.call(this, Asset.GetTexture(Asset.Textures.GAME_QUEUE));
        this.engine = engine;
        this.resuming = !!resuming;

        // The canvas backdrop (the same as the menu's) covers the empty arena until the game starts.
        this.width = this.engine.conf.width;
        this.height = this.engine.conf.height;
        this.engine.addChild("Queue", this);
        var backdrop = new Pixi.Sprite(Pixi.Texture.fromImage("/Content/Images/bg_faded.png"));
        backdrop.width = this.engine.conf.width;
        backdrop.height = this.engine.conf.height;
        this.addChild(backdrop);

        // The matchmaking panel
        var layer = this.layer = Hud.Layer('souls-classic-queue');
        var box = this.box = Hud.El('section', 's-panel sg-queue', layer);
        box.setAttribute('aria-label', T('classic.queue'));
        this.rings = Hud.El('div', 'sg-rings', box);
        this.title = Hud.El('h2', '', box);
        this.title.setAttribute('aria-live', 'polite');
        this.text = Hud.El('p', '', box, T('classic.queue.connecting'));
        this.text.setAttribute('aria-live', 'polite');
        this.time = Hud.El('div', 'sg-time', box, '0:00');
        this.time.setAttribute('role', 'timer');
        this.time.setAttribute('aria-label', T('classic.queue.waited'));
        this.chip = Hud.El('span', 's-chip', box);
        this.cancel = Hud.Button('s-btn s-btn-ghost', box, T('classic.queue.cancel'), 'close');
        this.cancel.addEventListener('click', function () { window.location.href = '/Game'; });

        var that = this;
        this.started = Date.now();
        this.clock = setInterval(function () { that.Tick(); }, 500);
        this.SetMode(engine.normalGame, engine.difficulty);

        // Friendly: challenge a player by name, or wait here to be challenged.
        if (engine.friendly) {
            var form = Hud.El('form', 'sg-challenge', null);
            var input = Hud.El('input', 's-input', form);
            input.placeholder = T('classic.queue.playerName');
            input.maxLength = 64;
            input.autocomplete = 'off';
            input.setAttribute('aria-label', T('classic.queue.playerToChallenge'));
            Hud.Button('s-btn s-btn-primary s-btn-sm', form, T('classic.queue.challenge'), 'swords').type = 'submit';
            form.addEventListener('submit', function (e) {
                e.preventDefault();
                var name = input.value.trim();
                if (name) engine.gameService.Challenge(name);
            });
            var withdraw = Hud.Button('s-btn s-btn-ghost s-btn-sm', null, T('classic.queue.withdraw'), 'close');
            withdraw.addEventListener('click', function () { engine.gameService.CancelChallenge(); });
            box.insertBefore(form, this.cancel);
            box.insertBefore(withdraw, this.cancel);
            this.friendly = { form: form, input: input, withdraw: withdraw };
            this.ChallengeIdle();
        }
    }
    // Constructor
    Queue.prototype = Object.create(Pixi.Sprite.prototype);
    Queue.prototype.constructor = Queue;
    Queue.DIFFICULTY_NAMES = DIFFICULTY_NAMES;

    Queue.prototype.Tick = function () {
        this.time.textContent = Hud.Clock(Date.now() - this.started - 999);
    }

    Queue.prototype.SetMode = function (normalGame, difficulty) {
        var profile = Conf.profile;
        var name = DIFFICULTY_NAMES[difficulty] || DIFFICULTY_NAMES[1];
        var friendly = !!this.engine.friendly;
        Hud.Clear(this.rings);
        this.rings.appendChild(Hud.Icon(friendly ? 'users' : normalGame ? 'swords' : 'bot'));

        if (this.resuming) this.title.textContent = T('classic.queue.rejoining');
        else this.title.textContent = friendly ? T('classic.queue.friendly') : normalGame ? T('classic.queue.finding') : T('classic.queue.preparing');

        Hud.Clear(this.chip);
        if (friendly) {
            this.chip.appendChild(Hud.Icon('users'));
            Hud.Text(this.chip, T('classic.queue.friendly.chip'));
        }
        else if (normalGame) {
            this.chip.appendChild(Hud.Icon('crown'));
            var text = T('classic.queue.ranked.chip');
            if (profile && typeof profile.rating === 'number') {
                text += ' · ' + (profile.tier || Hud.TierOf(profile.rating).name) + ' · ' + profile.rating;
            }
            Hud.Text(this.chip, text);
        }
        else {
            this.chip.appendChild(Hud.Icon('bot'));
            Hud.Text(this.chip, T('classic.queue.practice.chip', { difficulty: name }));
        }
    }

    /// The status line under the title.
    Queue.prototype.SetText = function (text) {
        this.text.textContent = String(text === undefined || text === null ? '' : text);
    }

    /// Logged in to the game server (10). The friendly lobby keeps its own text.
    Queue.prototype.Connected = function () {
        if (this.friendly) return;
        if (this.resuming) this.SetText(T('classic.queue.connected.resume'));
        else this.SetText(this.engine.normalGame ? T('classic.queue.connected.ranked') : T('classic.queue.connected.practice'));
    }

    /// In the queue (100).
    Queue.prototype.Queued = function () {
        if (this.resuming) return;
        this.SetText(this.engine.normalGame ? T('classic.queue.waiting.ranked') : T('classic.queue.waiting.practice'));
    }

    /// The challenge was sent (198): wait for the answer.
    Queue.prototype.ChallengeWaiting = function (name) {
        if (!this.friendly) return;
        this.friendly.form.hidden = true;
        this.friendly.withdraw.hidden = false;
        this.SetText(T('classic.queue.waiting.answer', { name: name }));
        this.started = Date.now();
    }

    /// Ready to challenge (again); text says what became of the last challenge (197). Outside friendly mode: a toast.
    Queue.prototype.ChallengeIdle = function (text) {
        if (!this.friendly) {
            if (text) this.engine.ScreenMessage([text]);
            return;
        }
        this.friendly.form.hidden = false;
        this.friendly.withdraw.hidden = true;
        var name = Conf.profile ? Conf.profile.name : T('classic.queue.yourName');
        this.SetText(text || T('classic.queue.friendly.idle', { name: name }));
    }

    /// <summary>
    /// Someone challenges you (199 {name, type, rating, expiresIn}): accept or decline before the time runs out.
    /// </summary>
    Queue.prototype.ShowInvite = function (p) {
        var that = this;
        this.HideInvite();
        var card = Hud.El('section', 's-panel sg-invite', Hud.Root());
        card.setAttribute('role', 'alertdialog');
        card.setAttribute('aria-label', T('classic.invite'));
        var head = Hud.El('div', 'sg-invite-head', card);
        var img = Hud.El('img', '', head);
        img.src = '/Content/Images/Player/Portraits/' + (Number(p.type) || 0) + '.png';
        img.alt = '';
        var who = Hud.El('div', '', head);
        Hud.El('b', '', who, T('classic.invite.title', { name: String(p.name) }));
        Hud.El('div', 's-muted s-small', who, T('classic.invite.sub') + (p.rating ? ' · ' + p.rating : ''));
        var bar = Hud.Progress(card, 1, 's-progress-ember', T('classic.invite.time'));
        var actions = Hud.El('div', 'sg-invite-actions', card);
        var decline = Hud.Button('s-btn s-btn-ghost s-btn-sm', actions, T('classic.invite.decline'), 'close');
        var accept = Hud.Button('s-btn s-btn-primary s-btn-sm', actions, T('classic.invite.accept'), 'check');
        var total = Number(p.expiresIn) || 30000;
        var ends = Date.now() + total;
        var timer = setInterval(function () {
            var left = ends - Date.now();
            Hud.SetProgress(bar, left / total);
            if (left <= 0) that.HideInvite();
        }, 250);
        function Answer(ok) {
            that.HideInvite();
            that.engine.gameService.AnswerChallenge(ok);
        }
        accept.addEventListener('click', function () { Answer(true); });
        decline.addEventListener('click', function () { Answer(false); });
        this.invite = { card: card, timer: timer };
        try { accept.focus({ preventScroll: true }); } catch (e) { /* focus is optional */ }
    }

    Queue.prototype.HideInvite = function () {
        if (!this.invite) return;
        clearInterval(this.invite.timer);
        Hud.Remove(this.invite.card);
        this.invite = null;
    }

    /// Something went wrong (not logged in, banned): the title says what, the clock stops.
    Queue.prototype.SetError = function (text) {
        clearInterval(this.clock);
        this.title.textContent = String(text);
        this.SetText(T('classic.error.retry'));
        this.cancel.lastChild.textContent = T('classic.backToMenu');
    }

    /// The game starts: "Prepare!", then the panel and the canvas backdrop fade out.
    Queue.prototype.FadeOut = function () {
        var that = this;
        clearInterval(this.clock);
        this.title.textContent = T('classic.queue.prepare');
        this.SetText(this.resuming ? T('classic.queue.back') : T('classic.queue.opponentHere'));

        var layer = this.layer;
        setTimeout(function () {
            Hud.CloseLayer(layer, true);
            that.engine.CreateJS.Tween.get(that)
                .to({ alpha: 0 }, 900, that.engine.CreateJS.Linear)
                .call(onComplete);
        }, 700);

        function onComplete() {
            // Remove from stage as we wont be needing this anymore.
            var group = that.engine.getGroup("Queue");
            if (group.parent) group.parent.removeChild(group);
        }
    }

    /// <summary>
    /// The end of the game: the result over the board, a summary (coins, rating, daily quests) and the page then
    /// moves on to the statistics of the game.
    /// </summary>
    /// <param name="text">Victory! / Defeat! / Draw!</param>
    /// <param name="statisticsId">The game id (statistics page)</param>
    /// <param name="payload">{statistics, text, coins, rating, ratingChange, quests, season, friendly}</param>
    /// <param name="kind">"victory", "defeat" or "draw"</param>
    Queue.prototype.FadeInGameEnd = function (text, statisticsId, payload, kind) {
        clearInterval(this.clock);
        Hud.Remove(this.layer);

        var gameId = parseInt(statisticsId, 10);
        var statsUrl = gameId > 0 ? "/Game/Stats/" + gameId : null;
        var moved = false;
        function moveOn() {
            if (moved) return;
            moved = true;
            window.location.replace(statsUrl || "/Game");
        }

        this.ShowSummary(String(text), payload || {}, gameId > 0 ? gameId : null, moveOn, kind);
    }

    /// The end screen; every server string is set as text. kind: "victory", "defeat" or "draw".
    Queue.prototype.ShowSummary = function (title, payload, gameId, moveOn, kind) {
        var old = this.endLayer;
        if (old) Hud.Remove(old);

        if (kind !== 'victory' && kind !== 'defeat') kind = 'draw';
        var layer = this.endLayer = Hud.Layer('souls-classic-end');
        if (!Hud.ReducedMotion()) layer.style.animation = 's-fade-in 1.2s ease-out both';
        var end = Hud.El('div', 'sg-end ' + kind, layer);
        end.setAttribute('role', 'dialog');
        end.setAttribute('aria-modal', 'true');
        end.setAttribute('aria-labelledby', 'souls-classic-end-title');

        var heading = Hud.El('h1', 'sg-end-title', end, title.replace(/!+$/, ''));
        heading.id = 'souls-classic-end-title';
        if (payload.text) Hud.El('div', 'sg-end-sub', end, L10n.text(payload));

        // Rewards: coins and rating (or "unrated" in practice, nothing in a friendly game), counting up.
        var friendly = payload.friendly === true || !!this.engine.friendlyGame;
        var rewards = Hud.El('div', 'sg-rewards', end);
        if (typeof payload.coins === 'number' && !friendly) {
            var coins = Hud.El('div', 's-panel sg-reward', rewards);
            coins.appendChild(Hud.Icon('coin'));
            var coinValue = Hud.El('b', '', coins, '+0');
            Hud.El('span', '', coins, T('classic.soulCoins'));
            Hud.CountUp(coinValue, payload.coins, payload.coins < 0 ? '-' : '+', 900);
        }
        if (typeof payload.ratingChange === 'number') {
            var change = payload.ratingChange;
            var up = change >= 0;
            var rating = Hud.El('div', 's-panel sg-reward ' + (up ? 'up' : 'down'), rewards);
            rating.appendChild(Hud.Icon('crown'));
            var ratingValue = Hud.El('b', '', rating, up ? '+0' : '-0');
            var now = typeof payload.rating === 'number' ? payload.rating : null;
            Hud.El('span', '', rating, now !== null ? Hud.TierOf(now).name + ' · ' + now : T('classic.end.rating'));
            if (now !== null) {
                var bar = Hud.Progress(rating, 0, '', T('classic.rankProgress'));
                Hud.Later(bar, Hud.RankProgress(now), 1100);
            }
            Hud.CountUp(ratingValue, Math.abs(change), up ? '+' : '-', 1000);
        }
        else if (!this.engine.normalGame || friendly) {
            var practice = Hud.El('div', 's-panel sg-reward', rewards);
            practice.appendChild(Hud.Icon(friendly ? 'users' : 'bot'));
            Hud.El('b', '', practice, '–');
            Hud.El('span', '', practice, friendly ? T('classic.end.friendly') : T('classic.end.practice'));
        }
        if (!rewards.firstChild) Hud.Remove(rewards);
        if (payload.season) SeasonResult(end, payload.season);

        if (payload.quests && payload.quests.length) {
            var quests = Hud.El('section', 's-panel sg-end-quests', end);
            quests.setAttribute('aria-label', T('classic.dailyQuests'));
            var head = Hud.El('div', 's-panel-head', quests);
            head.appendChild(Hud.Icon('quest'));
            Hud.El('h3', '', head, T('classic.dailyQuests'));
            Hud.QuestList(quests, payload.quests, true);
        }

        var actions = Hud.El('div', 'sg-end-actions', end);
        var first = null;
        if (gameId) {
            var stats = Hud.El('a', 's-btn s-btn-gold', actions);
            stats.href = '/Game/Stats/' + gameId;
            stats.appendChild(Hud.Icon('list'));
            Hud.Text(stats, T('classic.end.statistics'));
            var replay = Hud.El('a', 's-btn s-btn-ghost', actions);
            replay.href = '/Game/Replay/' + gameId;
            replay.appendChild(Hud.Icon('play'));
            Hud.Text(replay, T('classic.end.replay'));
            first = stats;
        }
        var again = Hud.El('a', 's-btn s-btn-primary', actions);
        again.href = '/Game';
        again.appendChild(Hud.Icon('swords'));
        Hud.Text(again, T('classic.end.again'));
        first = first || again;

        // Moves on by itself after a while (the buttons go now).
        var note = Hud.El('div', 'sg-end-redirect', end);
        var left = REDIRECT_SECONDS;
        var what = gameId ? 'classic.end.statisticsIn' : 'classic.end.menuIn';
        note.textContent = T(what, { n: left });
        var countdown = setInterval(function () {
            left--;
            note.textContent = T(what, { n: Math.max(0, left) });
            if (left <= 0) {
                clearInterval(countdown);
                moveOn();
            }
        }, 1000);

        try { first.focus({ preventScroll: true }); } catch (e) { /* focus is optional */ }
        return layer;
    }

    /// A ranked game's season: the rank emblem before and after, and a promotion or demotion.
    function SeasonResult(parent, season) {
        var change = season.promoted ? 'promoted' : season.demoted ? 'demoted' : '';
        var panel = Hud.El('section', 's-panel sg-end-season' + (change ? ' ' + change : ''), parent);
        var head = Hud.El('div', 's-panel-head', panel);
        head.appendChild(Hud.Icon('trophy'));
        Hud.El('h3', '', head, season.name ? L10n.text(season, 'name') : T('classic.end.season'));
        if (change) {
            var label = Hud.El('span', 'sg-season-change', head);
            label.appendChild(Hud.Icon(season.promoted ? 'arrow-up' : 'chevron-down'));
            Hud.Text(label, season.promoted ? T('classic.end.promoted') : T('classic.end.demoted'));
        }
        var ranks = Hud.El('div', 'sg-season-ranks', panel);
        function Badge(r, which) {
            r = r || {};
            Hud.RankBadge(ranks, Number(r.rating), r.tier ? L10n.text(r, 'tier') : '', String(r.css || '')).classList.add(which);
        }
        Badge(season.before, 'before');
        ranks.appendChild(Hud.Icon('chevron-right', 's-icon sg-season-arrow'));
        Badge(season.after, 'after');
    }

    return Queue;

});
