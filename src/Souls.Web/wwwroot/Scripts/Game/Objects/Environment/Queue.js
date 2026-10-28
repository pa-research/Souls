define("queue", ["jquery", "asset", "pixi"], function ($, Asset, Pixi) {

    Queue = function (engine) {
        Pixi.Sprite.call(this, Asset.GetTexture(Asset.Textures.GAME_QUEUE));
        console.log("> Queue Loaded")
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

    }
    // Constructor
    Queue.prototype = Object.create(Pixi.Sprite.prototype);
    Queue.prototype.constructor = Queue;


    Queue.prototype.SetText = function (text) {

        console.log(text);
        var that = this;

        this.engine.CreateJS.Tween.get(this.messageText)
       .to({ alpha: 0 }, 1000, this.engine.CreateJS.Linear)
       .call(function () { that.messageText.setText(text) })
       .to({ alpha: 1 }, 1000, this.engine.CreateJS.Linear)
    }


    Queue.prototype.FadeInGameEnd = function (text, statisticsId) {
        var that = this;
        that.alpha = 0;
        this.messageText.scale.x = 1;
        this.messageText.scale.y = 1;
        //this.engine.CreateJS.Tween.removeAllTweens();

        this.engine.stage.addChild(that.engine.getGroup("Queue"));
        that.messageText.setText(text)

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
        .to({ bgAlpha: 1, textAlpha: 0.5 }, 5000, this.engine.CreateJS.Linear)
        .to({ textAlpha: 1 }, 2500, this.engine.CreateJS.Linear)
        .to({ textScaleX: 2, textScaleY: 2 }, 1000, this.engine.CreateJS.Ease.sineInOut)
        .to({ textScaleX: 1, textScaleY: 1 }, 1000, this.engine.CreateJS.Ease.sineInOut)
        .to({ textScaleX: 2, textScaleY: 2 }, 1000, this.engine.CreateJS.Ease.sineInOut)
        .to({ textScaleX: 1, textScaleY: 1 }, 1000, this.engine.CreateJS.Ease.sineInOut)
        .to({ textScaleX: 10, textScaleY: 10, textAlpha: 0.0 }, 2500, this.engine.CreateJS.Ease.sineIn)
        .wait(3000)
        .call(function () {
            window.location.replace("/Game/Stats/" + statisticsId);
        });

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
           .wait(2000)
           .to({ alpha: 0 }, 5000, that.engine.CreateJS.Linear)
           .call(onComplete)

            function onComplete() {
                // Remove from stage as we wont be needing this anymore.
                this.engine.stage.removeChild(that.engine.getGroup("Queue"));
            }
        }
    }

    return Queue;

});