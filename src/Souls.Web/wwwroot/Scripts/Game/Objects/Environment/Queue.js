define("queue", ["jquery", "asset", "pixi"], function ($, Asset, Pixi) {

    var DIFFICULTY_NAMES = ["Easy", "Normal", "Hard"];

    Queue = function (engine) {
        Pixi.Sprite.call(this, Asset.GetTexture(Asset.Textures.GAME_QUEUE));
        this.engine = engine;

        this.width = this.engine.conf.width;
        this.height = this.engine.conf.height;
        this.engine.addChild("Queue", this);

        var textureBg = Pixi.Texture.fromImage("/Content/Images/bg_faded.png");
        var logo = new Pixi.Sprite(textureBg);
        logo.anchor = { x: 0, y: 0 }
        logo.x = 0;
        logo.y = 0;
        logo.width = this.engine.conf.width;
        logo.height = this.engine.conf.height;
        this.addChild(logo);


        // CardFactory Name Label
        this.messageText = new Pixi.Text("Connecting...",
            {
                font: "120px Arial bold",
                fill: "white",
                stroke: '#FFFFFF',
                wordWrap: true,
                align: 'center',

                wordWrapWidth: this.width
            });
        this.messageText.anchor = { x: 0.5, y: 0.5 };
        this.messageText.x = this.width / 2;
        this.messageText.y = this.height / 2;

        this.addChild(this.messageText);

        // Practice: which bot difficulty was asked for
        this.modeText = new Pixi.Text(" ",
            {
                font: "48px Arial",
                fill: "#f3e9d2",
                stroke: '#000000',
                strokeThickness: 6,
                align: 'center'
            });
        this.modeText.anchor = { x: 0.5, y: 0.5 };
        this.modeText.x = this.width / 2;
        this.modeText.y = this.height / 2 + 130;
        this.addChild(this.modeText);
        this.SetMode(engine.normalGame, engine.difficulty);
    }
    // Constructor
    Queue.prototype = Object.create(Pixi.Sprite.prototype);
    Queue.prototype.constructor = Queue;
    Queue.DIFFICULTY_NAMES = DIFFICULTY_NAMES;


    Queue.prototype.SetMode = function (normalGame, difficulty) {
        var name = DIFFICULTY_NAMES[difficulty] || DIFFICULTY_NAMES[1];
        this.modeText.setText(normalGame ? "Ranked match" : "Practice against the bot (" + name + ")");
    }

    Queue.prototype.SetText = function (text) {
        var that = this;

        this.engine.CreateJS.Tween.get(this.messageText)
       .to({ alpha: 0 }, 1000, this.engine.CreateJS.Linear)
       .call(function () { that.messageText.setText(text) })
       .to({ alpha: 1 }, 1000, this.engine.CreateJS.Linear)
    }


    /// <summary>
    /// The end of the game: the result fades in over the board, a summary (coins, rating, daily quests) is shown and
    /// the page then moves on to the statistics of the game.
    /// </summary>
    /// <param name="text">Victory! / Defeat! / Draw!</param>
    /// <param name="statisticsId">The game id (statistics page)</param>
    /// <param name="payload">{statistics, text, coins, rating, ratingChange, quests}</param>
    Queue.prototype.FadeInGameEnd = function (text, statisticsId, payload) {
        var that = this;
        that.alpha = 0;
        this.messageText.scale.x = 1;
        this.messageText.scale.y = 1;
        this.modeText.visible = false;

        this.engine.stage.addChild(that.engine.getGroup("Queue"));
        that.messageText.setText(text)

        var gameId = parseInt(statisticsId, 10);
        var statsUrl = gameId > 0 ? "/Game/Stats/" + gameId : null;
        function moveOn() {
            window.location.replace(statsUrl || "/Game");
        }

        var tweenVals =
            {
                textAlpha: that.messageText.alpha,
                bgAlpha: this.alpha,
                textScaleX: this.messageText.scale.x,
                textScaleY: this.messageText.scale.y
            }


        this.engine.CreateJS.Tween.removeAllTweens();
        this.engine.CreateJS.Tween.get(tweenVals, {
            override: false, onChange: function () {
                that.alpha = tweenVals.bgAlpha;
                that.messageText.alpha = tweenVals.textAlpha;
                that.messageText.scale.x = tweenVals.textScaleX;
                that.messageText.scale.y = tweenVals.textScaleY;

            }
        })
        .to({ bgAlpha: 1, textAlpha: 0.5 }, 3000, this.engine.CreateJS.Linear)
        .to({ textAlpha: 1 }, 1500, this.engine.CreateJS.Linear)
        .to({ textScaleX: 1.6, textScaleY: 1.6 }, 1000, this.engine.CreateJS.Ease.sineInOut)
        .to({ textScaleX: 1, textScaleY: 1 }, 1000, this.engine.CreateJS.Ease.sineInOut);

        this.ShowSummary(text, payload || {}, statsUrl, moveOn);

        // Move on to the statistics after a while (the summary has a button to go now).
        setTimeout(moveOn, 25000);
    }

    /// The reward summary as a DOM panel; every server string is set as text.
    Queue.prototype.ShowSummary = function (title, payload, statsUrl, moveOn) {
        var old = document.querySelector('.souls-classic-end');
        if (old && old.parentNode) old.parentNode.removeChild(old);

        function el(tag, className, text) {
            var node = document.createElement(tag);
            if (className) node.className = className;
            if (text !== undefined && text !== null) node.textContent = String(text);
            return node;
        }

        var panel = el('section', 'souls-classic-end');
        panel.setAttribute('role', 'dialog');
        panel.setAttribute('aria-label', 'Game result');

        var kind = /^victory/i.test(title) ? 'victory' : /^defeat/i.test(title) ? 'defeat' : 'draw';
        panel.classList.add('souls-classic-end-' + kind);
        panel.appendChild(el('h2', 'souls-classic-end-title', title));
        if (payload.text) panel.appendChild(el('p', 'souls-classic-end-text', payload.text));

        var rewards = el('ul', 'souls-classic-end-rewards');
        if (typeof payload.coins === 'number') {
            rewards.appendChild(el('li', 'souls-classic-end-coins', (payload.coins >= 0 ? '+' : '') + payload.coins + ' coins'));
        }
        if (typeof payload.ratingChange === 'number') {
            var change = payload.ratingChange;
            var rating = el('li', 'souls-classic-end-rating ' + (change > 0 ? 'up' : change < 0 ? 'down' : ''),
                'Rating ' + (typeof payload.rating === 'number' ? payload.rating + ' ' : '') + '(' + (change > 0 ? '+' : '') + change + ')');
            rewards.appendChild(rating);
        }
        else if (typeof payload.rating === 'number') {
            rewards.appendChild(el('li', 'souls-classic-end-rating', 'Rating ' + payload.rating + ' (practice: unchanged)'));
        }
        if (rewards.childNodes.length) panel.appendChild(rewards);

        if (payload.quests && payload.quests.length) {
            panel.appendChild(el('h3', 'souls-classic-end-subtitle', 'Daily quests'));
            var quests = el('ul', 'souls-classic-end-quests');
            for (var i = 0; i < payload.quests.length; i++) {
                var q = payload.quests[i] || {};
                var target = Number(q.target) || 0;
                var progress = Math.min(Number(q.progress) || 0, target || Number(q.progress) || 0);
                var item = el('li', q.done ? 'done' : '');
                item.appendChild(el('span', 'souls-classic-quest-text', q.text));
                var bar = el('span', 'souls-classic-quest-bar');
                var fill = el('span', 'souls-classic-quest-fill');
                fill.style.width = (target > 0 ? Math.round(100 * progress / target) : (q.done ? 100 : 0)) + '%';
                bar.appendChild(fill);
                item.appendChild(bar);
                item.appendChild(el('span', 'souls-classic-quest-progress', progress + ' / ' + target));
                item.appendChild(el('span', 'souls-classic-quest-reward', q.done ? 'Done! +' + (Number(q.reward) || 0) + ' coins' : '+' + (Number(q.reward) || 0) + ' coins'));
                quests.appendChild(item);
            }
            panel.appendChild(quests);
        }

        var button = el('button', 'souls-classic-end-continue', statsUrl ? 'Battle statistics' : 'Back to the menu');
        button.type = 'button';
        button.addEventListener('click', moveOn);
        panel.appendChild(button);

        document.body.appendChild(panel);
        setTimeout(function () { panel.classList.add('shown'); }, 1200);
    }


    Queue.prototype.FadeOut = function () {
        var that = this;

        this.engine.CreateJS.Tween.get(this.messageText)
        .to({ alpha: 0 }, 1000, this.engine.CreateJS.Linear)
        .call(function () { that.messageText.setText("Prepare!") })
        .to({ alpha: 1 }, 1000, this.engine.CreateJS.Linear)
        .call(fadeOut)

        function fadeOut() {
            that.engine.CreateJS.Tween.get(that)
           .wait(1000)
           .to({ alpha: 0 }, 2000, that.engine.CreateJS.Linear)
           .call(onComplete)

            function onComplete() {
                // Remove from stage as we wont be needing this anymore.
                var group = that.engine.getGroup("Queue");
                if (group.parent) group.parent.removeChild(group);
            }
        }
    }

    return Queue;

});
