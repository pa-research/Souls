define("card", [
    'pixi',
    'asset',
    'stopwatch',
    'messages',
    'conf',
    'animation',
    'cardtype',
    'iAnimation'], function (pixi, asset, StopWatch, Message, Conf, Animation, CardType, AnimationInterface) {

        var that = this;

        Card = function (engine, jsonData, count) {
            var texture = asset.GetTexture(asset.Textures.CARD_NONE);
            pixi.Sprite.call(this, texture);



            // Engine reference
            this.engine = engine;

            // Make CardType Accessible
            this.CardType = CardType;

            // Card Animation
            this.Animation = new AnimationInterface();
            this.Animation.Attack = Animation.Card.Attack;
            this.Animation.Death = Animation.Card.Death;
            this.Animation.MoveBack = Animation.Card.MoveBack;
            this.Animation.MoveTo = undefined; //TODO
            this.Animation.Defend = Animation.Card.Defend;
            this.Animation.PutIn = Animation.Card.PutInSlot;
            this.Animation.Heal = Animation.General.Heal;
            this.Animation.GainAttack = Animation.General.GainAttack;
            this.Animation.Sacrifice = Animation.General.Sacrifice;

            // Create a global tunnel to "this" object
            that = this;

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
            this.cid = (!!jsonData.cid) ? jsonData.cid : "NA";
            this.health = "NA";
            this.cost = "NA";
            this.name = "NA";
            this.attack = "NA";
            this.ability = "NA";
            this.id = (!!jsonData.id) ? jsonData.id : 0;
            this.race = (!!jsonData.race) ? jsonData.race.id : 0;
            this.isDead = false;
            this.abilityId = (!!jsonData.ability) ? jsonData.ability.id : undefined,

            //this.SetText({ race:  });

            // Setup the card layout / graphics
            this.SetupFrontCard(this);
            this.SetupBackCard(this);
            this.addChild(this.frontCard);

            // Setup the text data
            this.SetText(
                {
                    health: jsonData.health,
                    attack: jsonData.attack,
                    name: jsonData.name,
                    cost: jsonData.cost,
                    ability: (!!jsonData.ability) ? jsonData.ability.name : undefined,
                    race: jsonData.race,
                    id: jsonData.id

                });

            // Interaction definitions
            this.hoverSlot = undefined;
            this.inSlot = undefined;
            this.owner = undefined;
            this.pickedUp = false;
            this.cardFlipped = false;
            this.target = undefined;
            this.antiSpam = true;
            this.rightClick = undefined;


        };
        // Global order counter
        Card.counter = 0;

        // Constructor
        Card.prototype = Object.create(pixi.Sprite.prototype);
        Card.prototype.constructor = Card;

        /// <summary>
        /// Sets a text field on the card depending on what the input is. see param
        /// </summary>
        /// <param name="text">Example on format : {health: 10, cost: 5}</param>
        Card.prototype.SetText = function (text) {

            if (text.health) {
                this.health = text.health;
                this.texts.health.setText(text.health);

            }
            if (text.cost || text.cost == 0) {
                this.cost = text.cost;
                this.texts.cost.setText(text.cost);
            }
            if (text.ability) {
                this.ability = text.ability;
                this.texts.ability.setText(text.ability);
            }
            if (text.name) {
                this.name = text.name;
                this.texts.name.setText(text.name);
            }
            if (text.attack) {
                this.attack = text.attack;
                this.texts.attack.setText(text.attack);
            }
            if (text.race) {
                this.race = text.race.id;
            }
            if (text.id) {
                this.id = text.id;
            }
        }

        Card.prototype.Reset = function () {

        }


        Card.prototype.SetupBackCard = function () {
            // Make card backside
            this.backCard = new pixi.Sprite(asset.GetTexture(asset.Textures.CARD_BACK));
            this.backCard.anchor = { x: 0.5, y: 0.5 };
            this.backCard.height = 210;
            this.backCard.width = 150;
        }

        Card.prototype.SetupFrontCard = function () {
            // Make card frontside
            this.frontCard = new pixi.Sprite(CardType.GetCardTexture(this.race));
            this.frontCard.anchor = { x: 0.5, y: 0.5 };
            this.frontCard.height = 210;
            this.frontCard.width = 150;


            // Card Image
            this.portrait = new pixi.Sprite(CardType.GetPortraitTexture(this.id));
            this.portrait.anchor = { x: 0.5, y: 0.5 };
            this.portrait.width = 236;
            this.portrait.height = 167;
            this.portrait.x = 0;
            this.portrait.y = -31;
            this.frontCard.addChild(this.portrait);

            // CardFactory Health Label
            this.txtHealth = new pixi.Text(this.health,
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

            this.txtHealth.position.x = (this.frontCard.width) - (15 * this.health.length) + 3;
            this.txtHealth.position.y = (this.frontCard.height) - (this.txtHealth.height) - 2;
            this.texts.health = this.txtHealth;

            // CardFactory Mana Label
            var txtCost = new pixi.Text(this.cost,
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
            this.txtAttack = new pixi.Text(this.attack,
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
            var txtAbility = new pixi.Text(this.ability,
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
            var txtName = new pixi.Text(this.name,
                {
                    font: "40px Arial",
                    fill: "black",
                    wordWrap: true,
                    align: 'center',

                    wordWrapWidth: this.width
                });
            // txtName.anchor = { x: 1, y: 0.0 };
            txtName.x = -(this.frontCard.width) + 60
            txtName.y = -(this.frontCard.height) + 30
            this.texts.name = txtName;

            this.frontCard.addChild(this.txtHealth);
            this.frontCard.addChild(txtCost);
            this.frontCard.addChild(this.txtAttack);
            this.frontCard.addChild(txtAbility);
            this.frontCard.addChild(txtName);




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
            if (this.cardFlipped) {
                this.removeChild(this.backCard)
                this.addChild(this.frontCard)
                this.cardFlipped = false;
            }
            else {
                this.removeChild(this.frontCard)
                this.addChild(this.backCard)
                this.cardFlipped = true;
            }
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
            parent.removeChild(this);
            parent.addChild(this);
        }

        Card.prototype.OrderFirst = function () {
            var parent = this.parent;
            parent.removeChild(this);
            parent.addChildAt(this, 0);
        }

        Card.prototype.OrderOriginalPosition = function () {
            var parent = this.parent;

            parent.addChildAt(this, this.order);

            //console.log(this.name + " next in line is : " + ((!!parent.children[this.order + 1]) ? parent.children[this.order + 1].name : " none"));
            //console.log(parent)
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
                var position = { rotation: this.rotation };

                asset.GetSound(asset.Sound.CARD_PICKUP).play();

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
                    // this.hoverSlot.card = undefined;
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

                        // Run tween
                        this.interactive = false;
                        this.engine.CreateJS.Tween.get(this, { override: true })
                            .to({ y: this.position.originY - 120 }, 200, this.engine.CreateJS.Ease.elasticOut)
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
                                .to({ y: this.position.originY }, 500, this.engine.CreateJS.Ease.elasticOut)
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

            var target =
              {
                  x: cardSlot.x,
                  y: cardSlot.y
              }

            this.position.originX = cardSlot.x;
            this.position.originY = cardSlot.y;

            this.engine.CreateJS.Tween.get(this, { override: true })
                .to(target, 500, this.engine.CreateJS.Ease.ElasticInOut)
                .call(onComplete);

            function onComplete() {
                var originalWidth = this.width;

                asset.GetSound(asset.Sound.CARD_MOUNT).play(); // CHANGE ENEMY SOUND

                // Check if the card is owned by the player
                if (this.owner == this.engine.player) {
                    this.interactive = true;
                    asset.GetSound(asset.Sound.CARD_MOUNT).play();
                }
                else {

                    // Flip effect
                    var tweenShrink = this.engine.CreateJS.Tween.get(this, { override: true })
                    .to({ width: 0 }, 100, this.engine.CreateJS.Ease.ElasticInOut)
                    .call(function () { // CHain tweenback

                        this.FlipCard();

                        this.engine.CreateJS.Tween.get(this, { override: true })
                        .to({ width: originalWidth }, 100, this.engine.CreateJS.Ease.ElasticInOut)
                    });
                }
            } // On complete end
        } // PutInSlot end



        // Heals *this* for {amount} health
        Card.prototype.Heal = function (health, src) {
            this.Animation.Heal(this.txtHealth);
            this.SetText({ health: health });
        }

        Card.prototype.AddAttack = function (attack, src) {
            this.Animation.GainAttack(this.txtAttack);
            this.SetText({ attack: attack });
        }

        Card.prototype.Sacrifice = function (data, tar) {
            var health = data.split(":")[0];
            var attack = data.split(":")[1];

            tar.Heal(health, this);
            tar.AddAttack(attack, this);
            this.Animation.Sacrifice(this, tar);
        }

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

        }

        /// <summary>
        /// This function checks weither a "this" card has a value set in his target variable 
        /// (This is called on mouseRelease). If its set trigger a rquest Attack to the server.
        /// </summary>
        Card.prototype.CheckAttack = function () {

            // If a object is set as "target" on "this" card, AND leftClick is done, We do attack
            if (!!this.target && !this.rightClick) {

                var isTargetOpponent = (this.target == this.engine.opponent) ? 1 : 0;
                this.engine.gameService.Request_Attack(this, this.target, isTargetOpponent);

            }

                // If a object is set as "target" on "this" card, and rightClick is done, We will do ability on "target"
            else if (!!this.target && this.rightClick) {


                // Card on Card = 0
                // Card on Player = 1 (Friendly Player)
                // Card on Opponent = 2 (Opponent)
                var isTargetPlayer = (this.target == this.engine.player) ? 1 : 0;
                var isTargetOpponent = (this.target == this.engine.opponent) ? 2 : 0;
                var type = 0 + isTargetPlayer + isTargetOpponent

                this.engine.gameService.Request_Ability(this, this.target, type);
            }

            // If the target is set, reset it
            if (!!this.target) {
                // Rescale the Target and deselect it
                this.target.ScaleDown();
                this.target = undefined;
            }

        }



        /// <summary>
        /// 
        /// </summary>
        /// <param name="attackerInfo"></param>
        /// <param name="defenderInfo"></param>
        /// <param name="defender"></param>
        Card.prototype.Attack = function (attackerInfo, defenderInfo, defender) {
            var attacker = this;
            this.engine.player.arrow.Hide();

            // Set the correct health
            attacker.health = attackerInfo.health;
            defender.health = defenderInfo.health;

            // Check and set death
            if (attacker.health <= 0) {
                attacker.isDead = true // Sets the card dead
                attacker.inSlot.Reset(); // Reset the card slot
            }

            if (defender.health <= 0) {
                defender.isDead = true; // Sets the card dead
                defender.inSlot.Reset(); // Resets the card slot

            }



            // Define callbacks which should be used in the card Animation
            var attackCallbacks =
                {
                    ChangeHealth: function () {

                        defender.SetText(
                        {
                            health: defender.health
                        });

                        //Attacker
                        attacker.SetText(
                        {
                            health: attacker.health
                        });
                    }
                }

            attacker.Animation.Attack(attacker, defender, attackCallbacks);
        }


        Card.prototype.AttackOpponent = function (attackerInfo, defenderInfo, defender) {
            var attacker = this;

            // Set the correct health
            attacker.health = attackerInfo.health;
            defender.health = defenderInfo.health;

            // Check and set death
            if (attacker.health <= 0) {
                attacker.isDead = true // Sets the card dead
                attacker.inSlot.Reset(); // Reset the card slot
            }

            if (defender.health <= 0) {
                defender.isDead = true; // Sets the card dead
                // defender.inSlot.Reset(); // Resets the card slot

            }


            // Define callbacks which should be used in the card Animation
            var attackCallbacks =
                {


                    ChangeHealth: function () {
                        console.log(defender.health);
                        defender.SetText(
                        {
                            health: defender.health
                        });

                        //Attacker
                        attacker.SetText(
                        {
                            health: attacker.health
                        });
                    }
                }


            attacker.Animation.Attack(attacker, defender, attackCallbacks);
        }



        /// <summary>
        /// Mouse callbacks
        /// </summary>
        ////////////////////
        /* Card.prototype.mouseover = function (data) {
              this.isOver = true;
          };
        
          Card.prototype.mouseout = function (data) {
              //this.isOver = false;
         
          }
          */

        Card.prototype.mousedown = Card.prototype.touchstart = function (mouseData) {
            var event = mouseData.originalEvent;
            var leftClick = (event.which == 1) ? true : false;
            var rightClick = (event.which == 3) ? true : false;
            this.rightClick = rightClick;

            // If its a left click
            if (leftClick) {


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

            }
            else if (rightClick) // If player right clicks
            {

                // Ensure that card is IN a slot and also that the card is NOT picked up
                if (this.inSlot && !this.pickedUp) {
                    this.Pickup();

                    console.log(":D wi")


                }

            }
        };

        // Mouse - Release
        Card.prototype.mouseup = Card.prototype.mouseupoutside = Card.prototype.touchend = Card.prototype.touchendoutside = function (mouseData) {
            var event = mouseData.originalEvent;
            var leftClick = (event.which == 1) ? true : false;
            var rightClick = (event.which == 3) ? true : false;
            this.rightClick = rightClick;

            if (leftClick || rightClick) {

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