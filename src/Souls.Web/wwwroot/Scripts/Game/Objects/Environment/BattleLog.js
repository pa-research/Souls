// The battle log: a collapsible DOM panel fed by the "log" game events. Lines come from the server and are
// inserted with textContent only.
define("battlelog", [], function () {

    var MAX_LINES = 200;
    var STORAGE_KEY = 'souls.classic.logCollapsed';

    function ReadCollapsed() {
        try { return window.localStorage.getItem(STORAGE_KEY) === '1'; } catch (e) { return false; }
    }

    function WriteCollapsed(value) {
        try { window.localStorage.setItem(STORAGE_KEY, value ? '1' : '0'); } catch (e) { /* optional */ }
    }

    function BattleLog() {
        var panel = this.panel = document.createElement('section');
        panel.className = 'souls-classic-log';
        panel.setAttribute('aria-label', 'Battle log');
        panel.hidden = true;

        var toggle = this.toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.className = 'souls-classic-log-toggle';

        var title = document.createElement('span');
        title.textContent = 'Battle log';
        this.badge = document.createElement('span');
        this.badge.className = 'souls-classic-log-badge';
        this.badge.hidden = true;
        toggle.appendChild(title);
        toggle.appendChild(this.badge);

        var list = this.list = document.createElement('ol');
        list.className = 'souls-classic-log-list';
        list.id = 'souls-classic-log-list';
        list.setAttribute('aria-live', 'polite');
        toggle.setAttribute('aria-controls', list.id);

        panel.appendChild(toggle);
        panel.appendChild(list);
        document.body.appendChild(panel);

        this.unread = 0;
        this.SetCollapsed(ReadCollapsed());

        var that = this;
        toggle.addEventListener('click', function () {
            that.SetCollapsed(!that.collapsed);
            WriteCollapsed(that.collapsed);
        });
    }

    BattleLog.prototype.SetCollapsed = function (collapsed) {
        this.collapsed = !!collapsed;
        this.panel.classList.toggle('collapsed', this.collapsed);
        this.toggle.setAttribute('aria-expanded', String(!this.collapsed));
        this.list.hidden = this.collapsed;
        if (!this.collapsed) {
            this.unread = 0;
            this.badge.hidden = true;
            this.list.scrollTop = this.list.scrollHeight;
        }
    }

    BattleLog.prototype.Show = function () {
        this.panel.hidden = false;
    }

    BattleLog.prototype.Hide = function () {
        this.panel.hidden = true;
    }

    /// Adds a line (plain text). kind: optional CSS modifier ("turn", "system").
    BattleLog.prototype.Add = function (text, kind) {
        if (text === undefined || text === null) return;
        var item = document.createElement('li');
        item.textContent = String(text);
        if (kind) item.className = 'souls-classic-log-' + kind;

        var atBottom = this.list.scrollHeight - this.list.scrollTop - this.list.clientHeight < 30;
        this.list.appendChild(item);
        while (this.list.childNodes.length > MAX_LINES) this.list.removeChild(this.list.firstChild);
        if (atBottom || this.collapsed) this.list.scrollTop = this.list.scrollHeight;

        if (this.collapsed) {
            this.unread++;
            this.badge.textContent = String(this.unread);
            this.badge.hidden = false;
        }
    }

    BattleLog.prototype.Destroy = function () {
        if (this.panel.parentNode) this.panel.parentNode.removeChild(this.panel);
    }

    return BattleLog;
});
