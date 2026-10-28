define("playerbase", ["jquery", "pixi", "asset", "iAnimation", "animation"], function ($, Pixi, Asset, AnimationInterface, Animation) {


    PlayerBase = function (engine, isPlayer) {
        var frame = (isPlayer) ? Asset.GetTexture(Asset.Textures.PLAYER_FRAME) : Asset.GetTexture(Asset.Textures.OPPONENT_FRAME);
        Pixi.Sprite.call(this, Asset.GetTexture(Asset.Textures.PLAYER_NONE));
        this.engine = engine;

        // Player Animation
        this.Animation = new AnimationInterface();
        this.Animation.Death = Animation.Player.Death;
        this.Animation.Defend = Animation.Player.Defend;
        this.Animation.Attack = Animation.Player.Attack;
        this.Animation.CardAttack = Animation.Player.CardAttack;
        this.Animation.Heal = Animation.General.Heal;
        this.Animation.GainAttack = Animation.General.GainAttack;
        this.Animation.Sacrifice = Animation.General.Sacrifice;

        var json = { name: "NA", attack: "NA", health: "NA", mana: "NA", type: 0 };

        // Defining variables
        this.anchor = { x: 0.5, y: 0.5 };
        this.width = 300;
        this.height = 250;
        this.isPlayer = isPlayer;
        this.health = json.health;
        this.attack = json.attack;
        this.mana = json.mana;
        this.name = json.name;
        this.type = json.type;
        this.manaCrystals = new Array();


        // Making mask for the portrait
        var masking = new Pixi.Graphics();
        masking.beginFill(0xFFFFFF);
        masking.lineStyle(0, 0xffffff);
        masking.fillAlpha = 0.5;
        masking.drawEllipse(0, 0, this.width / 2.2, this.height / 2.1);
        masking.endFill();
        masking.x -= 4;

        // Player Frame
        var pFrame = new Pixi.Sprite(frame);
        pFrame.anchor = { x: 0.5, y: 0.5 };
        pFrame.width = this.width;
        pFrame.height = this.height;

        this._originalScale =
            {
                x: this.scale.x,
                y: this.scale.y
            }


        // Player Portrait
        this.pPortrait = this.portrait = new Pixi.Sprite(this.GetPortrait(this.type));
        this.pPortrait.anchor = { x: 0.5, y: 0.5 };
        this.pPortrait.width = this.width;
        this.pPortrait.height = this.height;
        this.pPortrait.x = 0;
        this.pPortrait.y = 0;

        this.pPortrait.mask = masking;

        // Name text
        this.pNamePanelText = new Pixi.Text(this.name,
            {
                font: "26px Helvetica",
                fill: "white",
                wordWrap: true,
                align: 'center',

                wordWrapWidth: this.width
            });
        this.pNamePanelText.anchor = { x: 0.5, y: 1 };
        this.pNamePanelText.x = 0;
        this.pNamePanelText.y = this.height / 2.1;

        // Attack damage text
        this.pAttackText = new Pixi.Text(this.attack,
            {
                font: "35px Arial",
                fill: "white",
                stroke: '#000000',
                strokeThickness: 4,
                align: 'center',

                wordWrapWidth: this.width
            });
        this.pAttackText._originalScale =
        {
            x: this.pAttackText.scale.x,
            y: this.pAttackText.scale.y
        };
        this.pAttackText.anchor = { x: 0.5, y: 1 };
        this.pAttackText.x -= this.width / 2.66;
        this.pAttackText.y += this.height / 3.2;

        // Health text
        this.pHealthText = new Pixi.Text(this.health,
            {
                font: "35px Arial",
                fill: "white",
                stroke: '#000000',
                strokeThickness: 4,
                align: 'center',

                wordWrapWidth: this.width
            });
        this.pHealthText.anchor = { x: 0.5, y: 1 };
        this.pHealthText.x += this.width / 2.65;
        this.pHealthText.y += this.height / 3.2;

        this.pHealthText._originalScale =
        {
            x: this.pHealthText.scale.x,
            y: this.pHealthText.scale.y
        };


        // Adding sprites to base
        this.addChild(this.pPortrait);
        this.addChild(masking);
        this.addChild(pFrame);
        this.addChild(this.pNamePanelText);
        this.addChild(this.pAttackText);
        this.addChild(this.pHealthText);

        // Generating the manacrystals in elipse around owner
        var num = 10;
        var deg = (Math.PI * 2) / 180;
        var degJump = (Math.PI / 180) * 20
        var radiusX = (this.width - 10) / 2;
        var radiusY = (this.height - 25) / 2;
        var YOffset;
        var startOffset

        if (!!this.isPlayer) {
            startOffset = 9;
            YOffset = 0;
        }
        else {
            startOffset = 0;
            YOffset = 25;
        }

        for (var i = 0; i < num; i++) {
            var item = this.manaCrystals[i];
            item = new Pixi.Sprite(Asset.GetTexture(Asset.Textures.PLAYER_MANA));
            item.anchor = { x: 0.5, y: 0.5 };
            item.width = 30;
            item.height = 30;
            item.tint = 0x6e93b3;
            item.x = this.x + radiusX * Math.cos(deg + (degJump * (i + startOffset))) - 2;
            item.y = this.y + radiusY * Math.sin(deg + (degJump * (i + startOffset))) - 15 + YOffset;
            item.visible = false;
            this.manaCrystals[i] = item;
            this.addChild(item);
        }

    }
    // Constructor
    PlayerBase.prototype = Object.create(Pixi.Sprite.prototype);
    PlayerBase.prototype.constructor = PlayerBase;

    PlayerBase.prototype.GetPortrait = function (portraitId) {
        var portraits =
            {
                0: Asset.Textures.PLAYER_PORTRAIT_UNKNOWN,
                1: Asset.Textures.PLAYER_PORTRAIT_ONE,
                2: Asset.Textures.PLAYER_PORTRAIT_TWO,
                3: Asset.Textures.PLAYER_PORTRAIT_THREE,
                4: Asset.Textures.PLAYER_PORTRAIT_FOUR,
                5: Asset.Textures.PLAYER_PORTRAIT_FIVE,
                6: Asset.Textures.PLAYER_PORTRAIT_SIX
            };

        if (portraits[portraitId]) {
            return Asset.GetTexture(portraits[portraitId]);
        }
        else {
            console.log("Missing PLAYER Texture ID: " + portraitId);
            return Asset.GetTexture(portraits[0]);
        }
    }

    PlayerBase.prototype.Process = function () {
        console.log("> [PlayerBase]: Implement Process()");
    }

    PlayerBase.prototype.Init = function () {
        console.log("> [PlayerBase]: Implement Init()");
        this.playerNr = undefined;
    }


    /// <summary>
    /// Sets a text field on the card depending on what the input is. see param
    /// </summary>
    /// <param name="text">Example on format : {health: 10, cost: 5}</param>
    PlayerBase.prototype.SetText = function (text) {
        this.graphicText = text;
        if (text.health) {
            this.health = text.health;
            this.pHealthText.setText(text.health);
        }
        if (text.mana || text.mana == 0) {
            this.mana = text.mana;

            $.each(this.manaCrystals, function (index, value) {

                if (index < text.mana) {
                    value.visible = true;
                }
                else {
                    value.visible = false;
                }

            });

            //this.pManaText.setText(text.mana);
        }
        if (text.ability) {
            //this.setText(text.ability);
        }
        if (text.name) {
            this.name = text.name;
            this.pNamePanelText.setText(text.name);
        }
        if (text.attack) {
            this.attack = text.attack;
            this.pAttackText.setText(text.attack);
        }
        if (text.race) {
            // this.race = text.race.id;
        }
        if (text.type) {
            this.pPortrait.texture = this.GetPortrait(text.type);
        }
    }

    PlayerBase.prototype.SetPosition = function (xy) {
        this.position = xy;
    }

    PlayerBase.prototype.ScaleUp = function () {
        this.scale.x = 1.1;
        this.scale.y = 1.2;
    }

    PlayerBase.prototype.ScaleDown = function () {
        this.scale.x = this._originalScale.x;
        this.scale.y = this._originalScale.y;
    }

    PlayerBase.prototype.Attack = function (jsonPlayerInfo, jsonOpponentInfo, defender) {
        var spriteGroup = this.engine.getGroup("Player-Particles");

        var that = this;
        var callbacks =
        {
            SetHealth: function () {
                that.SetText(
                    {
                        health: jsonPlayerInfo.health
                    });

                that.engine.opponent.SetText(
                    {
                        health: jsonOpponentInfo.health
                    });
            }
        }


        this.Animation.Attack(this.engine.player, this.engine.opponent, spriteGroup, callbacks);
        this.Animation.Attack(this.engine.opponent, this.engine.player, spriteGroup, callbacks);

    }

    // Heals *this* for {amount} health
    PlayerBase.prototype.Heal = function (health, src) {
        this.Animation.Heal(this.pHealthText);
        this.SetText({ health: health });
    }

    PlayerBase.prototype.AddAttack = function (attack, src) {
        this.Animation.GainAttack(this.pAttackText);
        this.SetText({ attack: attack });
    }

    PlayerBase.prototype.CardAttack = function (jsonPlayerInfo, jsonOpponentInfo, attacker, defender) {

        // Set the correct health
        attacker.health = jsonPlayerInfo.health;
        defender.health = jsonOpponentInfo.health;

        // Check and set death
        if (attacker.health <= 0) {
            attacker.isDead = true // Sets the card dead
            attacker.inSlot.Reset(); // Reset the card slot
        }

        if (defender.health <= 0) {
            defender.isDead = true; // Sets the card dead
            defender.inSlot.Reset(); // Resets the card slot

        }

        var callbacks =
        {
            SetHealth: function () {
                attacker.SetText(
                    {
                        health: jsonPlayerInfo.health
                    });

                defender.SetText(
                    {
                        health: jsonOpponentInfo.health
                    });
            }
        }


        this.Animation.CardAttack(attacker, defender, callbacks);
    }



    return PlayerBase
});