define("card", [
    'pixi',
    'asset',
    'stopwatch',
    'messages',
    'conf',
    'animation',
    'cardtype',
    'iAnimation',
    'rules'], function (pixi, asset, StopWatch, Message, Conf, Animation, CardType, AnimationInterface, Rules) {

        // Size of the card face on screen (the frame textures are scaled to this).
        var FACE_WIDTH = 150;
        var FACE_HEIGHT = 210;
        var LONG_PRESS_MS = 450;
        var LONG_PRESS_SLOP = 30;

        /// Sets a label only when its text changes (re-rendering a text is not free).
        function SetLabel(label, value) {
            var text = String(value);
            if (label.text !== text) label.setText(text);
        }

        function ToNumber(value, fallback) {
            if (value === undefined || value === null || value === '') return fallback;
            var n = Number(value);
            return isFinite(n) ? n : fallback;
        }

        /// What kind of pointer event this is: touch, left or right mouse button.
        function Pointer(mouseData) {
            var event = (mouseData && mouseData.originalEvent) || {};
            var touch = typeof event.type === 'string' && event.type.indexOf('touch') === 0;
            return {
                touch: touch,
                left: touch || event.which == 1,
                right: !touch && event.which == 3
            };
        }

        Card = function (engine, jsonData, count) {
            var texture = asset.GetTexture(asset.Textures.CARD_NONE);
            pixi.Sprite.call(this, texture);

            jsonData = jsonData || {};

            // Engine reference
            this.engine = engine;

            // Make CardType Accessible
            this.CardType = CardType;

            // Card Animation
            this.Animation = new AnimationInterface();
            this.Animation.Death = Animation.Card.Death;
            this.Animation.MoveBack = Animation.Card.MoveBack;
            this.Animation.MoveTo = undefined; //TODO
            this.Animation.Defend = Animation.Card.Defend;
            this.Animation.PutIn = Animation.Card.PutInSlot;
            this.Animation.Heal = Animation.General.Heal;
            this.Animation.GainAttack = Animation.General.GainAttack;

            // Card Position
            this.anchor = { x: 0.5, y: 0.5 };
            this.position.x = this.position.originX = 0;
            this.position.y = this.position.originY = 0;
            this.order = count; // Must be set on card creation (When adding to group)

            // Create a stopwatch for network pulse (Movement specifically)
            this.networkStopWatch = new Stopwatch();
            this.networkStopWatch.start();

            // Card definitions
            this.backCard = undefined;
            this.frontCard = undefined;
            this.texts = {
                health: '',
                cost: '',
                ability: '',
                attack: '',
                name: '',
                id: ''
            }; //List with text objects

            // Card Data
            this.cid = (jsonData.cid !== undefined && jsonData.cid !== null) ? jsonData.cid : "NA";
            this.health = "NA";
            this.maxHealth = undefined;
            this.cost = "NA";
            this.name = "NA";
            this.attack = "NA";
            this.ability = "NA";
            this.armor = 0;
            this.level = 1;
            this.paralyzed = false;
            this.taunt = false;
            this.token = false;
            this.canAct = false;
            this.hasAttacked = false;
            this.id = (jsonData.id !== undefined && jsonData.id !== null) ? jsonData.id : 0;
            this.race = (!!jsonData.race) ? jsonData.race.id : 0;
            this.portraitUrl = jsonData.portrait;
            this.isDead = false;
            this.abilityId = (!!jsonData.ability) ? jsonData.ability.id : undefined;

            // Setup the card layout / graphics
            this.SetupFrontCard(this);
            this.SetupBackCard(this);
            this.addChild(this.frontCard);
            this.SetupOverlay();

            // Interaction definitions
            this.hoverSlot = undefined;
            this.inSlot = undefined;
            this.owner = undefined;
            this.pickedUp = false;
            this.cardFlipped = false;
            this.target = undefined;
            this.targetKind = undefined;
            this.antiSpam = true;
            this.rightClick = undefined;

            // Setup the text data and badges
            this.UpdateFromJson(jsonData);
        };
        // Global order counter
        Card.counter = 0;

        // Constructor
        Card.prototype = Object.create(pixi.Sprite.prototype);
        Card.prototype.constructor = Card;
        Card.Pointer = Pointer;

        /// <summary>
        /// Sets a text field on the card depending on what the input is. see param
        /// </summary>
        /// <param name="text">Example on format : {health: 10, cost: 5}</param>
        Card.prototype.SetText = function (text) {

            if (text.health !== undefined && text.health !== null) {
                this.health = ToNumber(text.health, text.health);
                SetLabel(this.texts.health, text.health);
            }
            if (text.cost !== undefined && text.cost !== null) {
                this.cost = ToNumber(text.cost, text.cost);
                SetLabel(this.texts.cost, text.cost);
            }
            if (text.ability) {
                this.ability = text.ability;
                SetLabel(this.texts.ability, text.ability);
            }
            if (text.name) {
                this.name = text.name;
                SetLabel(this.texts.name, text.name);
            }
            if (text.attack !== undefined && text.attack !== null) {
                this.attack = ToNumber(text.attack, text.attack);
                SetLabel(this.texts.attack, text.attack);
            }
            if (text.race) {
                this.race = text.race.id;
            }
            if (text.id) {
                this.id = text.id;
            }
            this.UpdateHealthColor();
        }

        /// <summary>
        /// Applies a card JSON from the server (any subset of its fields): stats, statuses, art.
        /// </summary>
        Card.prototype.UpdateFromJson = function (json) {
            if (!json) return;

            var oldId = this.id;
            var oldRace = this.race;
            var oldPortrait = this.portraitUrl;

            if (json.id !== undefined && json.id !== null) this.id = json.id;
            if (json.race !== undefined) this.race = json.race ? json.race.id : 0;
            if (json.race) this.raceName = json.race.name;
            if (json.ability !== undefined) {
                this.abilityId = json.ability ? json.ability.id : undefined;
                this.abilityName = json.ability ? json.ability.name : undefined;
            }
            if (json.portrait) this.portraitUrl = json.portrait;
            if (json.maxHealth !== undefined && json.maxHealth !== null) this.maxHealth = ToNumber(json.maxHealth, this.maxHealth);
            if (json.armor !== undefined && json.armor !== null) this.armor = ToNumber(json.armor, 0);
            if (json.level !== undefined && json.level !== null) this.level = ToNumber(json.level, 1);
            if (json.paralyzed !== undefined) this.paralyzed = !!json.paralyzed;
            if (json.taunt !== undefined) this.taunt = !!json.taunt;
            if (json.token !== undefined) this.token = !!json.token;
            if (json.hasAttacked !== undefined) this.hasAttacked = !!json.hasAttacked;
            if (json.canAct !== undefined) this.canAct = !!json.canAct;

            var abilityText;
            if (json.ability !== undefined) {
                abilityText = json.ability ? (json.ability.name || (Rules.Ability(json.ability.id) || {}).name) : undefined;
                if (!abilityText) {
                    abilityText = this.token ? 'Token' : ' ';
                    this.ability = abilityText;
                    SetLabel(this.texts.ability, abilityText);
                    abilityText = undefined;
                }
            }

            this.SetText({
                health: json.health,
                attack: json.attack,
                name: json.name,
                cost: json.cost,
                ability: abilityText
            });

            if (this.maxHealth === undefined && typeof this.health === 'number') this.maxHealth = this.health;

            // Art: the frame follows the race, the portrait the card (or its own portrait URL).
            if (this.frontCard && oldRace !== this.race) {
                this.frontCard.setTexture(CardType.GetCardTexture(this.race));
                this.frontCard.width = FACE_WIDTH;
                this.frontCard.height = FACE_HEIGHT;
            }
            if (this.portrait && (oldId !== this.id || oldPortrait !== this.portraitUrl)) {
                this.portrait.setTexture(CardType.GetPortraitTexture(this.id, this.portraitUrl));
                this.portrait.width = 236;
                this.portrait.height = 167;
            }

            this.RefreshVisuals();
        }

        Card.prototype.UpdateHealthColor = function () {
            if (!this.txtHealth) return;
            var damaged = typeof this.health === 'number' && typeof this.maxHealth === 'number' && this.health < this.maxHealth;
            if (this._damagedStyle === damaged) return;
            this._damagedStyle = damaged;
            this.txtHealth.setStyle({
                font: "45px Arial",
                fill: damaged ? "#ff5a4f" : "white",
                stroke: '#000000',
                strokeThickness: 4,
                align: "left"
            });
        }

        Card.prototype.Reset = function () {

        }


        Card.prototype.SetupBackCard = function () {
            // Make card backside
            this.backCard = new pixi.Sprite(asset.GetTexture(asset.Textures.CARD_BACK));
            this.backCard.anchor = { x: 0.5, y: 0.5 };
            this.backCard.height = FACE_HEIGHT;
            this.backCard.width = FACE_WIDTH;
        }

        Card.prototype.SetupFrontCard = function () {
            // Make card frontside
            this.frontCard = new pixi.Sprite(CardType.GetCardTexture(this.race));
            this.frontCard.anchor = { x: 0.5, y: 0.5 };
            this.frontCard.height = FACE_HEIGHT;
            this.frontCard.width = FACE_WIDTH;


            // Card Image
            this.portrait = new pixi.Sprite(CardType.GetPortraitTexture(this.id, this.portraitUrl));
            this.portrait.anchor = { x: 0.5, y: 0.5 };
            this.portrait.width = 236;
            this.portrait.height = 167;
            this.portrait.x = 0;
            this.portrait.y = -31;
            this.frontCard.addChild(this.portrait);

            // CardFactory Health Label
            this.txtHealth = new pixi.Text(String(this.health),
                {
                    font: "45px Arial",
                    fill: "white",
                    stroke: '#000000',
                    strokeThickness: 4,
                    align: "left"
                });
            this.txtHealth.anchor = { x: 0.5, y: 0.0 };

            this.txtHealth._originalScale =
            {
                x: this.txtHealth.scale.x,
                y: this.txtHealth.scale.y
            };

            this.txtHealth.position.x = (this.frontCard.width) - (15 * String(this.health).length) + 3;
            this.txtHealth.position.y = (this.frontCard.height) - (this.txtHealth.height) - 2;
            this.texts.health = this.txtHealth;

            // CardFactory Mana Label
            var txtCost = new pixi.Text(String(this.cost),
                {
                    font: "45px Arial",
                    fill: "white",
                    stroke: '#000000',
                    strokeThickness: 4
                });
            txtCost.position.x = -(this.frontCard.width) + 11;
            txtCost.position.y = -(this.frontCard.height) + 4;
            this.texts.cost = txtCost;

            // CardFactory Attack Label
            this.txtAttack = new pixi.Text(String(this.attack),
                {
                    font: "45px Arial",
                    fill: "white",
                    stroke: '#000000',
                    strokeThickness: 4
                });
            this.txtAttack._originalScale =
            {
                x: this.txtAttack.scale.x,
                y: this.txtAttack.scale.y
            };
            this.txtAttack.anchor = { x: 0, y: 0 };
            this.txtAttack.position.x = -(this.frontCard.width) + 10;
            this.txtAttack.position.y = (this.frontCard.height) - (this.txtAttack.height);
            this.texts.attack = this.txtAttack;

            // CardFactory Ability Label
            var txtAbility = new pixi.Text(String(this.ability),
                 {
                     font: "45px Arial",
                     fill: "black",
                     wordWrap: true,
                     wordWrapWidth: this.width - 24
                 });
            txtAbility.anchor = { x: 0.5, y: 0.6 };
            txtAbility.position.x = 0;
            txtAbility.position.y = this.frontCard.height / 2;
            this.texts.ability = txtAbility;

            // CardFry Name Label
            var txtName = new pixi.Text(String(this.name),
                {
                    font: "40px Arial",
                    fill: "black",
                    wordWrap: true,
                    align: 'center',

                    wordWrapWidth: this.width
                });
            txtName.x = -(this.frontCard.width) + 60
            txtName.y = -(this.frontCard.height) + 30
            this.texts.name = txtName;

            this.frontCard.addChild(this.txtHealth);
            this.frontCard.addChild(txtCost);
            this.frontCard.addChild(this.txtAttack);
            this.frontCard.addChild(txtAbility);
            this.frontCard.addChild(txtName);
        }

        /// Draws a small shield (armor, taunt).
        function DrawShield(g, w, h, fill, line) {
            g.lineStyle(3, line, 1);
            g.beginFill(fill, 1);
            g.moveTo(-w / 2, -h / 2);
            g.lineTo(w / 2, -h / 2);
            g.lineTo(w / 2, h * 0.05);
            g.lineTo(0, h / 2);
            g.lineTo(-w / 2, h * 0.05);
            g.lineTo(-w / 2, -h / 2);
            g.endFill();
        }
        Card.DrawShield = DrawShield;

        /// Draws a lightning bolt in a circle (paralyzed).
        function DrawBolt(g, r) {
            g.lineStyle(3, 0xd6ecff, 1);
            g.beginFill(0x1f4f9e, 1);
            g.drawCircle(0, 0, r);
            g.endFill();
            g.lineStyle(0, 0, 0);
            g.beginFill(0xffe14d, 1);
            g.moveTo(r * 0.25, -r * 0.8);
            g.lineTo(-r * 0.45, r * 0.1);
            g.lineTo(0, r * 0.1);
            g.lineTo(-r * 0.25, r * 0.8);
            g.lineTo(r * 0.45, -r * 0.1);
            g.lineTo(0, -r * 0.1);
            g.lineTo(r * 0.25, -r * 0.8);
            g.endFill();
        }
        Card.DrawBolt = DrawBolt;

        /// Status badges drawn above the card face, in card coordinates (the face is 150 x 210).
        Card.prototype.SetupOverlay = function () {
            var overlay = this.overlay = new pixi.DisplayObjectContainer();

            // Can act this turn: green glow
            this.glow = new pixi.Graphics();
            this.glow.lineStyle(7, 0x4dff7a, 1);
            this.glow.drawRect(-FACE_WIDTH / 2 - 4, -FACE_HEIGHT / 2 - 4, FACE_WIDTH + 8, FACE_HEIGHT + 8);
            this.glow.visible = false;

            // Taunt: a steel border and a shield on the right edge
            this.tauntFrame = new pixi.Graphics();
            this.tauntFrame.lineStyle(9, 0xa9b4bf, 1);
            this.tauntFrame.drawRect(-FACE_WIDTH / 2 - 2, -FACE_HEIGHT / 2 - 2, FACE_WIDTH + 4, FACE_HEIGHT + 4);
            var tauntIcon = new pixi.Graphics();
            DrawShield(tauntIcon, 30, 36, 0x6d7a87, 0xe6edf3);
            tauntIcon.x = FACE_WIDTH / 2 + 2;
            tauntIcon.y = -12;
            this.tauntFrame.addChild(tauntIcon);
            this.tauntFrame.visible = false;

            // Valid target while aiming
            this.targetMark = new pixi.Graphics();
            this.targetMark.visible = false;
            this.targetMarkColor = null;

            // Paralyzed: blue veil and a bolt on the left edge
            this.paralyzeMark = new pixi.Graphics();
            this.paralyzeMark.beginFill(0x5a8cff, 0.28);
            this.paralyzeMark.drawRect(-FACE_WIDTH / 2, -FACE_HEIGHT / 2, FACE_WIDTH, FACE_HEIGHT);
            this.paralyzeMark.endFill();
            var bolt = new pixi.Graphics();
            DrawBolt(bolt, 17);
            bolt.x = -FACE_WIDTH / 2 - 2;
            bolt.y = -12;
            this.paralyzeMark.addChild(bolt);
            this.paralyzeMark.visible = false;

            // Armor: a grey shield with the value, bottom centre between attack and health
            this.armorBadge = new pixi.DisplayObjectContainer();
            var armorShield = new pixi.Graphics();
            DrawShield(armorShield, 38, 42, 0x7f8c99, 0xf2f5f8);
            this.armorText = new pixi.Text("0", {
                font: "bold 24px Arial",
                fill: "white",
                stroke: '#000000',
                strokeThickness: 4
            });
            this.armorText.anchor = { x: 0.5, y: 0.5 };
            this.armorText.y = -3;
            this.armorBadge.addChild(armorShield);
            this.armorBadge.addChild(this.armorText);
            this.armorBadge.x = 0;
            this.armorBadge.y = FACE_HEIGHT / 2 - 18;
            this.armorBadge.visible = false;

            // Level stars along the top edge
            this.stars = new pixi.Text(" ", {
                font: "bold 20px Arial",
                fill: "#ffd54a",
                stroke: '#000000',
                strokeThickness: 4
            });
            this.stars.anchor = { x: 0.5, y: 0.5 };
            this.stars.y = -FACE_HEIGHT / 2 + 4;
            this.stars.visible = false;

            overlay.addChild(this.glow);
            overlay.addChild(this.paralyzeMark);
            overlay.addChild(this.tauntFrame);
            overlay.addChild(this.targetMark);
            overlay.addChild(this.armorBadge);
            overlay.addChild(this.stars);
            this.addChild(overlay);
        }

        /// Shows the badges that match the card's state.
        Card.prototype.RefreshVisuals = function () {
            if (!this.overlay) return;
            var onBoard = !!this.inSlot;
            var ownCard = !!(this.engine && this.engine.player && this.owner === this.engine.player);

            this.overlay.visible = !this.cardFlipped;
            this.armorBadge.visible = this.armor > 0;
            if (this.armorBadge.visible) SetLabel(this.armorText, this.armor);

            var stars = this.level >= 2 ? new Array(Math.min(this.level, 5) + 1).join("\u2605") : "";
            this.stars.visible = stars.length > 0;
            if (stars) SetLabel(this.stars, stars);

            this.tauntFrame.visible = onBoard && this.taunt;
            this.paralyzeMark.visible = onBoard && this.paralyzed;
            this.glow.visible = onBoard && ownCard && this.canAct && !this.paralyzed && !!this.engine.myTurn;

            this.RestoreTint();
            this.UpdateHealthColor();
        }

        /// Tints the card face for a moment (hit, burn, ...); RestoreTint goes back to the status tint.
        Card.prototype.SetFlash = function (color, ms) {
            if (this.frontCard) this.frontCard.tint = color;
            if (this.portrait) this.portrait.tint = color;
            var that = this;
            clearTimeout(this._flashTimer);
            if (ms) this._flashTimer = setTimeout(function () { that.RestoreTint(); }, ms);
        }

        Card.prototype.RestoreTint = function () {
            var tint = (this.paralyzed && this.inSlot) ? 0x9fbfff : 0xFFFFFF;
            if (this.frontCard) this.frontCard.tint = tint;
            if (this.portrait) this.portrait.tint = tint;
        }

        /// Marks the card as a valid target while the player aims (null removes the mark).
        Card.prototype.SetTargetMark = function (color) {
            if (this.targetMarkColor === color) return;
            this.targetMarkColor = color;
            this.targetMark.clear();
            if (color === null || color === undefined) {
                this.targetMark.visible = false;
                return;
            }
            this.targetMark.lineStyle(5, color, 0.95);
            this.targetMark.drawRect(-FACE_WIDTH / 2 - 9, -FACE_HEIGHT / 2 - 9, FACE_WIDTH + 18, FACE_HEIGHT + 18);
            this.targetMark.visible = true;
        }

        /// Where the card rests: its slot on the board, else its place in the hand.
        Card.prototype.GetHome = function () {
            if (this.inSlot) return { x: this.inSlot.x, y: this.inSlot.y };
            if (this.position.originX !== undefined) return { x: this.position.originX, y: this.position.originY };
            return { x: this.x, y: this.y };
        }


        /// <summary>
        /// Checks if the card is hovered over a cardslot
        /// </summary>
        Card.prototype.checkHover = function () {
            if (this.pickedUp && !this.inSlot) {

                // Get cardSlot group
                var cardSlots = this.engine.player.cardManager.cardSlots;

                var hoverSlot;

                for (var index in cardSlots) {
                    var cardslot = cardSlots[index];


                    // Check if card is hovering a cardSlot
                    if ((Toolbox.Rectangle.intersectsYAxis(this, cardslot, { x: -10, y: -15 }, { x: 3, y: 3 }) == true)) {
                        hoverSlot = index;

                        cardslot.doScaling(true);
                    }
                    else {
                        cardslot.doScaling(false);
                    }
                }

                if (!!hoverSlot) {
                    this.hoverSlot = cardSlots[hoverSlot];
                }
                else if (!!this.hoverSlot) {
                    this.hoverSlot = undefined;
                }
            }
        }

        /// <summary>
        /// Flips the card to the opposite side
        /// </summary>
        Card.prototype.FlipCard = function () {
            // The face goes below the badge overlay (index 0).
            if (this.cardFlipped) {
                this.removeChild(this.backCard)
                this.addChildAt(this.frontCard, 0)
                this.cardFlipped = false;
            }
            else {
                this.removeChild(this.frontCard)
                this.addChildAt(this.backCard, 0)
                this.cardFlipped = true;
            }
            if (this.overlay) this.overlay.visible = !this.cardFlipped;
        }

        Card.prototype.ScaleUp = function () {
            this.scale.x = 1.2;
            this.scale.y = 1.2;
        }

        Card.prototype.ScaleDown = function () {
            this.scale.x = 1;
            this.scale.y = 1;
        }

        Card.prototype.OrderLast = function () {
            var parent = this.parent;
            if (!parent) return;
            parent.removeChild(this);
            parent.addChild(this);
        }

        Card.prototype.OrderFirst = function () {
            var parent = this.parent;
            if (!parent) return;
            parent.removeChild(this);
            parent.addChildAt(this, 0);
        }

        Card.prototype.OrderOriginalPosition = function () {
            var parent = this.parent;
            if (!parent) return;
            var order = typeof this.order === 'number' ? this.order : parent.children.length - 1;
            parent.addChildAt(this, Math.max(0, Math.min(order, parent.children.length - 1)));
        }

        /// <summary>
        /// Picks up the card
        /// </summary>
        Card.prototype.Pickup = function () {
            if (!this.pickedUp) {
                this.ScaleUp();

                this.OrderLast();


                this.pickedUp = true;

                this.engine.player.holdingCard = this;

                Animation.PlaySound(asset.Sound.CARD_PICKUP, 0.6);

                if (this.inSlot) {
                    this.engine.SwapFromToGroup(this, "Card-Player", "Card-Focus");
                }
            }
        }

        /// <summary>
        /// Puts down the card
        /// </summary>
        Card.prototype.PutDown = function () {
            if (!!this.pickedUp) {
                this.ScaleDown();

                // Do scaling for the hoverslot if exists
                if (!!this.hoverSlot) {
                    this.hoverSlot.doScaling();
                }

                if (this.inSlot) {
                    this.engine.SwapFromToGroup(this, "Card-Focus", "Card-Player");
                }

                this.pickedUp = false;
                this.engine.player.lastHoldingCard = this.engine.player.holdingCard;
                this.engine.player.holdingCard = undefined;
            }
        }

        /// <summary>
        /// Function which processes Hover effects on the card (Player hovers the card)
        /// </summary>
        Card.prototype.OnHoverEffects = function () {
            // Only fire when card is not picked up
            if (!this.pickedUp &&
                !this.inSlot &&
                !this.engine.player.holdingCard &&
                !this._awaitRequest) {



                // Create a mouse object to test intersection with
                var mouse =
                    {
                        x: this.engine.conf.mouse.x + (this.width / 2) - 25,
                        y: this.engine.conf.mouse.y,
                        width: 59,
                        height: this.height - 50

                    }


                // Check if the mouse intersects the card
                var mouseIntersects = Toolbox.Rectangle.intersectsYAxis(this, mouse, { x: 0, y: 0 }, { x: 0, y: 0 });


                // If the mouse intersects
                if (mouseIntersects && !(mouse.y < (this.engine.conf.height - 200))) {

                    if (this.owner._chover != this) {
                        this.OrderOriginalPosition();
                        this.owner._chover = this;
                        this._reset = false;
                        // Scale up
                        this.scale = { x: 2.2, y: 2.2 };

                        // Run tween (x too: a hover may interrupt the tween that sorts the hand)
                        this.interactive = false;
                        this.engine.CreateJS.Tween.get(this, { override: true })
                            .to({ x: this.position.originX, y: this.position.originY - 120 }, 200, this.engine.CreateJS.Ease.elasticOut)
                            .call(function () {
                                this.interactive = true;
                            })


                        this.OrderLast();
                    }
                }
                else {

                    if (this.owner._chover == this) {
                        this._reset = false;
                        this.owner._chover = undefined;
                    }
                    else {
                        if (!this._reset) {

                            // Run tween
                            this.interactive = false;
                            this.engine.CreateJS.Tween.get(this, { override: true })
                                .to({ x: this.position.originX, y: this.position.originY }, 500, this.engine.CreateJS.Ease.elasticOut)
                                .call(function () {
                                    this.interactive = true;
                                })


                            this.ScaleDown();
                            this._reset = true;
                        }
                    }

                    if (!this.owner._chover) {
                        this.OrderOriginalPosition();
                    }

                }
            }// -- Picked Up
        } // -- Function

        /// <summary>
        /// Puts a card in a slot
        /// </summary>
        /// <param name="cardSlot">a card slot</param>
        Card.prototype.PutInSlot = function (cardSlot) {
            cardSlot.card = this;
            cardSlot.visible = false;
            this.inSlot = cardSlot;
            this.interactive = false;
            this.hoverSlot = undefined;
            this._awaitRequest = false;
            this.ScaleDown();
            this.RefreshVisuals();

            var target =
              {
                  x: cardSlot.x,
                  y: cardSlot.y
              }

            this.position.originX = cardSlot.x;
            this.position.originY = cardSlot.y;

            this.engine.CreateJS.Tween.get(this, { override: true })
                .to(target, 500, this.engine.CreateJS.Ease.quadOut)
                .call(onComplete);

            function onComplete() {
                var originalWidth = this.width;

                // Check if the card is owned by the player
                if (this.owner == this.engine.player) {
                    this.interactive = !this.isDead;
                    Animation.PlaySound(asset.Sound.CARD_MOUNT, 0.6);
                }
                else {
                    Animation.PlaySound(asset.Sound.CARD_MOUNT, 0.6);
                    if (!this.cardFlipped) return;

                    // Flip effect
                    this.engine.CreateJS.Tween.get(this, { override: true })
                    .to({ width: 0 }, 100, this.engine.CreateJS.Ease.quadIn)
                    .call(function () { // Chain tweenback

                        this.FlipCard();

                        this.engine.CreateJS.Tween.get(this, { override: true })
                        .to({ width: originalWidth }, 100, this.engine.CreateJS.Ease.quadOut)
                    });
                }
            } // On complete end
        } // PutInSlot end



        /// <summary>
        /// Processes the Card
        /// </summary>
        Card.prototype.Process = function () {

            // Check if the card is dragged, and not in a slot.
            if (this.dragging && this.networkStopWatch.getElapsed().milliseconds > 200 && !this.inSlot) {
                this.networkStopWatch.reset();
                this.engine.gameService.RequestMove(this);
            }

            // Check if card hovers a cardslot
            this.checkHover();

            // Check if player hovers a card
            this.OnHoverEffects();

            // Pulse the "can act" glow
            if (this.glow && this.glow.visible) {
                this.glow.alpha = 0.55 + 0.45 * Math.sin(Date.now() / 220);
            }
        }

        /// <summary>
        /// Called on release: sends the attack (left button / drag) or the ability (right button / long press)
        /// on the target picked while aiming.
        /// </summary>
        Card.prototype.CheckAttack = function () {
            var target = this.target;
            var kind = this.targetKind;

            if (!!target && !!kind) {
                if (!this.rightClick) {
                    // 0 = card on card, 1 = card on hero
                    this.engine.gameService.Request_Attack(this, target, kind === 'enemyHero' ? 1 : 0);
                }
                else {
                    // 0 = friendly card, 1 = own hero, 2 = enemy hero, 3 = enemy card
                    this.engine.gameService.Request_Ability(this, target, Rules.TargetType[kind]);
                }
            }

            // If the target is set, reset it
            if (!!target && target.ScaleDown) {
                target.ScaleDown();
            }
            this.target = undefined;
            this.targetKind = undefined;
        }


        /// <summary>
        /// Mouse and touch callbacks. Touch: drag a hand card to a slot to play it, drag from a board card to a
        /// target to attack, or hold a board card for a moment (long press) and then drag to use its ability.
        /// </summary>
        Card.prototype.mousedown = Card.prototype.touchstart = function (mouseData) {
            if (this.isDead || this.cardFlipped) return;

            var pointer = Pointer(mouseData);
            this.rightClick = pointer.right;
            this.touchInput = pointer.touch;
            this.engine.SetPointer(mouseData.global, pointer.touch);
            this._downAt = Date.now();
            this._downPos = { x: mouseData.global.x, y: mouseData.global.y };
            clearTimeout(this._longPressTimer);

            if (pointer.left) {
                var mouse = mouseData.getLocalPosition(this.parent);
                this.position.click =
                    {
                        x: mouse.x,
                        y: mouse.y
                    };

                // Pickup the card
                this.Pickup();

                // Only show cardslots on unslotted cards
                if (!this.inSlot) {
                    this.x = mouse.x;
                    this.y = mouse.y;
                    this.engine.getGroup("CardSlot-Player").visible = true;
                }

                this.dragging = true;

                // Touch has no right button: holding a board card switches to its ability.
                if (pointer.touch && this.inSlot) {
                    var that = this;
                    this._longPressTimer = setTimeout(function () {
                        if (!that.pickedUp || !that.inSlot || that.rightClick || that.isDead) return;
                        var m = that.engine.conf.mouse;
                        var dx = m.x - that._downPos.x, dy = m.y - that._downPos.y;
                        if (dx * dx + dy * dy > LONG_PRESS_SLOP * LONG_PRESS_SLOP) return;
                        that.rightClick = true;
                        var ability = Rules.Ability(that.abilityId);
                        Animation.Fx.Glow(that.engine, that, 0x5aa9ff);
                        Animation.Fx.Float(that.engine, that, ability ? ability.name : (that.abilityName || "Ability"), "#8fc8ff", 30, -120);
                    }, LONG_PRESS_MS);
                }
            }
            else if (pointer.right) // If player right clicks
            {
                // Ensure that card is IN a slot and also that the card is NOT picked up
                if (this.inSlot && !this.pickedUp) {
                    this.Pickup();
                }
            }
        };

        // Mouse - Release
        Card.prototype.mouseup = Card.prototype.mouseupoutside = Card.prototype.touchend = Card.prototype.touchendoutside = function (mouseData) {
            // Only the card that was picked up handles the release (a release over another card must not act on it).
            if (!this.pickedUp && !this.dragging) return;

            var pointer = Pointer(mouseData);
            clearTimeout(this._longPressTimer);

            if (pointer.touch) {
                // Aim at the point where the finger left the screen.
                this.engine.SetPointer(mouseData.global, true);
                if (this.engine.player) this.engine.player.UpdateAim();
            }

            var hadTarget = !!this.target;
            var moved = this._downPos ? Math.abs(mouseData.global.x - this._downPos.x) + Math.abs(mouseData.global.y - this._downPos.y) : 0;
            var tap = pointer.touch && !hadTarget && moved < 20 && (Date.now() - (this._downAt || 0)) < 400;

            this.engine.getGroup("CardSlot-Player").visible = false;

            // Put the card down
            this.PutDown();

            // Reset arrow.
            this.owner.arrow.Reset();

            // Check and execute the card attack
            this.CheckAttack();

            // Check and Request a release of the card
            this.engine.gameService.RequestRelease(this);

            // Check and Request a "UseCard"
            this.engine.gameService.Request_UseCard(this);

            // Removes hovercard from owner
            this.owner._chover = undefined;

            // Disable Dragging
            this.dragging = false;

            if (pointer.touch) {
                // A tap shows what the card does; then forget the finger so nothing stays "hovered".
                if (tap && this.engine.tooltip) this.engine.tooltip.Pin(this, 3500);
                this.engine.ClearPointer();
            }
        };

        // Dragging Callback
        Card.prototype.mousemove = Card.prototype.touchmove = function (data) {

            // While the dragging variable is set @see Card.prototype.mousedown and Card.prototype.mouseup
            if (this.dragging) {
                var mouse = data.getLocalPosition(this.parent);

                // If the card is not in slot
                if (!this.inSlot) {
                    this.x = mouse.x;
                    this.y = mouse.y;
                }

            }
        };

        return Card;

    });
