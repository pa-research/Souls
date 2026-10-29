// The battle log: a collapsible panel (.sg-log) fed by the "log" game events, top right under the Classic / 3D
// switch. Every line gets an icon and a colour from its wording; the players' names are highlighted (yours blue, the
// opponent's red). Lines come from the server and are inserted as text nodes only.
define("battlelog", ["hud"], function (Hud) {

    var MAX_LINES = 200;
    var STORAGE_KEY = 'souls.logCollapsed'; // shared with the 3D client
    var LIST_ID = 'souls-classic-log-list';

    function ReadCollapsed() {
        var value = Hud.ReadStorage(STORAGE_KEY);
        if (value === '1') return true;
        if (value === '0') return false;
        return Hud.SmallScreen(); // collapsed by default on small screens
    }

    function BattleLog() {
        var panel = this.panel = Hud.El('section', 'sg-log souls-classic-log', Hud.Root());
        panel.setAttribute('aria-label', 'Battle log');
        panel.hidden = true;

        var head = this.toggle = Hud.El('button', 'sg-log-head', panel);
        head.type = 'button';
        head.appendChild(Hud.Icon('list'));
        Hud.Text(head, 'Battle log');
        this.badge = Hud.El('span', 'sg-log-badge', head);
        head.appendChild(Hud.Icon('chevron-down', 's-icon sg-chevron'));

        var list = this.list = Hud.El('ol', 'sg-log-list', panel);
        list.id = LIST_ID;
        list.setAttribute('aria-live', 'polite');
        head.setAttribute('aria-controls', LIST_ID);

        this.unread = 0;
        this.names = { me: null, foe: null };
        this.SetCollapsed(ReadCollapsed());

        var that = this;
        head.addEventListener('click', function () {
            that.SetCollapsed(!that.collapsed);
            Hud.WriteStorage(STORAGE_KEY, that.collapsed ? 1 : 0);
        });
    }

    BattleLog.prototype.SetCollapsed = function (collapsed) {
        this.collapsed = !!collapsed;
        this.panel.classList.toggle('collapsed', this.collapsed);
        this.toggle.setAttribute('aria-expanded', String(!this.collapsed));
        if (!this.collapsed) {
            this.unread = 0;
            this.list.scrollTop = this.list.scrollHeight;
        }
        this.UpdateBadge();
    }

    /// The unread count while collapsed (an empty badge is hidden by the shared CSS).
    BattleLog.prototype.UpdateBadge = function () {
        var count = this.collapsed ? this.unread : 0;
        this.badge.textContent = count > 0 ? String(count) : '';
        this.toggle.setAttribute('aria-label', count > 0 ? 'Battle log, ' + count + ' unread' : 'Battle log');
    }

    BattleLog.prototype.Show = function () {
        this.panel.hidden = false;
    }

    BattleLog.prototype.Hide = function () {
        this.panel.hidden = true;
    }

    /// The names highlighted in the lines: yours (.me) and the opponent's (.foe).
    BattleLog.prototype.SetNames = function (me, foe) {
        this.names = { me: me ? String(me) : null, foe: foe ? String(foe) : null };
    }

    /// Appends the line to a span, wrapping every occurrence of a player's name in span.me / span.foe.
    BattleLog.prototype.Highlight = function (span, line) {
        var names = [];
        if (this.names.me && this.names.me.length > 1) names.push([this.names.me, 'me']);
        if (this.names.foe && this.names.foe.length > 1 && this.names.foe !== this.names.me) names.push([this.names.foe, 'foe']);
        var rest = line;
        while (rest.length) {
            var best = null;
            for (var i = 0; i < names.length; i++) {
                var at = rest.indexOf(names[i][0]);
                // The earliest match wins; on a tie the longer name (one name may contain the other).
                if (at >= 0 && (!best || at < best.at || (at === best.at && names[i][0].length > best.name.length))) {
                    best = { at: at, name: names[i][0], css: names[i][1] };
                }
            }
            if (!best) {
                Hud.Text(span, rest);
                break;
            }
            if (best.at > 0) Hud.Text(span, rest.slice(0, best.at));
            Hud.El('span', best.css, span, best.name);
            rest = rest.slice(best.at + best.name.length);
        }
    }

    /// Adds a line (plain text). kind "system": the result of the game.
    BattleLog.prototype.Add = function (text, kind) {
        if (text === undefined || text === null) return;
        var line = String(text);
        var look = kind === 'system' ? ['trophy', 'end'] : Hud.Classify(line);

        var item = document.createElement('li');
        if (look[1]) item.className = look[1];
        item.appendChild(Hud.Icon(look[0]));
        var span = Hud.El('span', '', item);
        this.Highlight(span, line);

        var list = this.list;
        var atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 30;
        list.appendChild(item);
        while (list.childNodes.length > MAX_LINES) list.removeChild(list.firstChild);
        if (atBottom || this.collapsed) list.scrollTop = list.scrollHeight;

        if (this.collapsed) {
            this.unread++;
            this.UpdateBadge();
        }
    }

    BattleLog.prototype.Destroy = function () {
        Hud.Remove(this.panel);
    }

    return BattleLog;
});
