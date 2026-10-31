// The loading screen and the main menu of the classic client, as DOM layers over the canvas (shared components from
// css/game-hud.css): ranked, practice against the bot with its difficulty, watching live games (3D client), links to
// the deck and the shop, the player's champion card with rank and the daily quests from the page config.
define("menu", ["hud", "conf"], function (Hud, Conf) {

    var TIPS = [
        ['Armor', 'absorbs damage before health, on cards and heroes.'],
        ['Taunt', 'cards must be attacked before anything else.'],
        ['Charge', 'lets a card attack the turn it is played; the others arrive exhausted.'],
        ['Hero powers', 'cost 2 mana and can be used once per turn.'],
        ['Darkness', 'cards curse a random enemy for 2 when they die.'],
        ['Vampiric', 'cards heal your hero by the damage they deal.'],
        ['Haunt', 'brings a card back to your hand the first time it dies.'],
        ['Fatigue', 'hurts more with every draw once your deck is empty.'],
        ['The turn timer', 'ends your turn after 75 seconds. Three timeouts in a row lose the game.'],
        ['Ranked', 'games move your rating; practice games do not.']
    ];

    var DIFFICULTIES = ['Easy', 'Normal', 'Hard'];
    var LIVE_URL = '/Game?live=1'; // spectating is offered by the 3D client only (game-mode.js opens it)

    function Portrait(type) {
        return '/Content/Images/Player/Portraits/' + (Number(type) || 0) + '.jpg';
    }

    /// <summary>
    /// The loading screen: logo, "Loading · 42%", a progress bar and rotating gameplay tips.
    /// Returns {SetProgress(fraction), Close()}.
    /// </summary>
    function ShowLoading() {
        var layer = Hud.Layer('souls-classic-loading');
        var box = Hud.El('div', 'sg-loading', layer);
        var logo = Hud.El('img', 'sg-logo', box);
        logo.src = '/Content/Images/logo.png';
        logo.alt = 'Souls';
        var text = Hud.El('div', 'sg-loading-text', box, 'Loading');
        var bar = Hud.Progress(box, 0, '', 'Loading');
        var tip = Hud.El('div', 'sg-loading-tip', box);

        var last = -1;
        function NextTip() {
            var index = Math.floor(Math.random() * TIPS.length);
            if (index === last) index = (index + 1) % TIPS.length;
            last = index;
            Hud.Clear(tip);
            Hud.El('b', '', tip, TIPS[index][0]);
            Hud.Text(tip, ' ' + TIPS[index][1]);
        }
        NextTip();
        var tipTimer = setInterval(NextTip, 4500);
        var shown = -1;

        return {
            layer: layer,
            SetProgress: function (fraction) {
                var percent = Math.round(Math.max(0, Math.min(1, Number(fraction) || 0)) * 100);
                if (percent === shown) return;
                shown = percent;
                Hud.SetProgress(bar, percent / 100);
                text.textContent = 'Loading · ' + percent + '%';
            },
            Close: function () {
                clearInterval(tipTimer);
                Hud.Remove(layer);
            }
        };
    }

    /// .sg-menu-btn: icon, title and subtitle, chevron.
    function MenuButton(parent, iconName, title, subtitle, primary) {
        var button = Hud.El('button', 'sg-menu-btn' + (primary ? ' primary' : ''), parent);
        button.type = 'button';
        Hud.El('span', 'sg-menu-icon', button).appendChild(Hud.Icon(iconName));
        var label = Hud.El('span', 'sg-menu-label', button);
        Hud.El('b', '', label, title);
        Hud.El('small', '', label, subtitle);
        button.appendChild(Hud.Icon('chevron-right'));
        return button;
    }

    /// The champion card: portrait, name, rank emblem, class and coins, progress to the next rank.
    function ProfilePanel(parent, profile) {
        var panel = Hud.El('section', 's-panel', parent);
        panel.setAttribute('aria-label', 'Your champion');
        var box = Hud.El('div', 'sg-profile', panel);
        var img = Hud.El('img', '', box);
        img.alt = '';
        img.src = Portrait(profile.type);
        img.onerror = function () { img.onerror = null; img.src = Portrait(0); };

        var who = Hud.El('div', '', box);
        Hud.El('h2', '', who, profile.name);
        var rating = Number(profile.rating) || 0;
        Hud.RankBadge(who, rating, profile.tier, profile.tierCss);
        var meta = Hud.El('div', 's-muted s-small', who);
        if (profile.typeName) Hud.Text(meta, profile.typeName + ' · ');
        var coins = Hud.El('span', 's-chip s-chip-coin', meta);
        coins.title = 'Soul coins';
        coins.appendChild(Hud.Icon('coin'));
        Hud.Text(coins, Number(profile.money) || 0);

        var progress = typeof profile.rankProgress === 'number' ? profile.rankProgress : Hud.RankProgress(rating);
        Hud.Progress(box, progress, '', 'Progress to the next rank');
        return panel;
    }

    function QuestPanel(parent, quests) {
        var panel = Hud.El('section', 's-panel', parent);
        panel.setAttribute('aria-label', 'Daily quests');
        var head = Hud.El('div', 's-panel-head', panel);
        head.appendChild(Hud.Icon('quest'));
        Hud.El('h3', '', head, 'Daily quests');
        Hud.QuestList(panel, quests, false);
        return panel;
    }

    /// <summary>
    /// The main menu. options: {profile, difficulty, onRanked(), onPractice(difficulty), onFriendly(), onDifficulty(difficulty)}.
    /// Returns {layer, Close(), SetDifficulty(d)}.
    /// </summary>
    function ShowMenu(options) {
        options = options || {};
        var difficulty = (options.difficulty >= 0 && options.difficulty <= 2) ? options.difficulty : 1;
        var closed = false;

        var layer = Hud.Layer('souls-classic-menu');
        var menu = Hud.El('div', 'sg-menu', layer);

        var nav = Hud.El('nav', 'sg-menu-nav', menu);
        nav.setAttribute('aria-label', 'Game menu');
        var logo = Hud.El('img', 'sg-logo', nav);
        logo.src = '/Content/Images/logo.png';
        logo.alt = 'Souls';

        var ranked = MenuButton(nav, 'swords', 'Ranked', 'Fight a player of your rank', true);
        var practice = MenuButton(nav, 'bot', 'Practice', 'Against the bot');

        // Bot difficulty: a radio group (arrow keys move the choice).
        var row = Hud.El('div', 'sg-menu-row', nav);
        var label = Hud.El('span', 's-label', row, 'Bot');
        label.id = 'souls-classic-difficulty-label';
        var seg = Hud.El('div', 's-seg', row);
        seg.setAttribute('role', 'radiogroup');
        seg.setAttribute('aria-labelledby', label.id);
        var radios = DIFFICULTIES.map(function (name, level) {
            var radio = Hud.Button('', seg, name);
            radio.setAttribute('role', 'radio');
            radio.addEventListener('click', function () { Choose(level, false); });
            return radio;
        });

        function Paint() {
            radios.forEach(function (radio, level) {
                var on = level === difficulty;
                radio.classList.toggle('active', on);
                radio.setAttribute('aria-checked', String(on));
                radio.tabIndex = on ? 0 : -1;
            });
        }

        function Choose(level, focus) {
            difficulty = Math.max(0, Math.min(2, level));
            Paint();
            if (focus) radios[difficulty].focus();
            if (options.onDifficulty) options.onDifficulty(difficulty);
        }
        Paint();

        seg.addEventListener('keydown', function (e) {
            var key = e.key;
            if (key === 'ArrowRight' || key === 'ArrowDown') Choose((difficulty + 1) % 3, true);
            else if (key === 'ArrowLeft' || key === 'ArrowUp') Choose((difficulty + 2) % 3, true);
            else if (key === 'Home') Choose(0, true);
            else if (key === 'End') Choose(2, true);
            else return;
            e.preventDefault();
            e.stopPropagation();
        });

        var friendly = MenuButton(nav, 'users', 'Friendly', 'Challenge a player by name, unranked');
        var watch = MenuButton(nav, 'eye', 'Watch live', 'Take a seat in the stands (3D)');

        var small = Hud.El('div', 'sg-menu-small', nav);
        [['/Deck', 'deck', 'Deck'], ['/Shop', 'shop', 'Shop'], ['/', 'home', 'Home']].forEach(function (link) {
            var a = Hud.El('a', 's-btn s-btn-ghost s-btn-sm', small);
            a.href = link[0];
            a.appendChild(Hud.Icon(link[1]));
            Hud.Text(a, link[2]);
        });

        // Up / down moves between the entries of the menu (the difficulty counts as one entry).
        nav.addEventListener('keydown', function (e) {
            if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
            var items = [ranked, practice, radios[difficulty], friendly, watch];
            var links = small.querySelectorAll ? small.querySelectorAll('a') : [];
            for (var i = 0; i < links.length; i++) items.push(links[i]);
            var index = items.indexOf(document.activeElement);
            var next = index === -1 ? 0 : (index + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length;
            e.preventDefault();
            items[next].focus();
        });

        var profile = options.profile;
        if (profile) {
            var side = Hud.El('aside', 'sg-menu-side', menu);
            side.setAttribute('aria-label', 'Your profile');
            ProfilePanel(side, profile);
            if (profile.quests && profile.quests.length) QuestPanel(side, profile.quests);
        }

        function Pick(fn) {
            return function () {
                if (closed) return;
                if (fn) fn(difficulty);
            };
        }
        ranked.addEventListener('click', Pick(options.onRanked));
        practice.addEventListener('click', Pick(options.onPractice));
        friendly.addEventListener('click', Pick(options.onFriendly));
        watch.addEventListener('click', Pick(function () {
            if (options.onWatch) options.onWatch();
            else window.location.href = LIVE_URL;
        }));

        try { ranked.focus({ preventScroll: true }); } catch (e) { /* focus is optional */ }

        return {
            layer: layer,
            buttons: { ranked: ranked, practice: practice, friendly: friendly, watch: watch, difficulty: radios },
            Difficulty: function () { return difficulty; },
            SetDifficulty: function (level) { Choose(level, false); },
            Close: function () {
                closed = true;
                Hud.Remove(layer);
            }
        };
    }

    return {
        TIPS: TIPS,
        DIFFICULTIES: DIFFICULTIES,
        LIVE_URL: LIVE_URL,
        ShowLoading: ShowLoading,
        ShowMenu: ShowMenu
    };
});
