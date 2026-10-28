define("animation", ['tweenjs', 'easeljs', 'asset', 'pixi'], function (_, CreateJS, Asset, Pixi) {

    Animation = function () {

    }

    Animation.prototype.constructor = Animation;
    Animation.prototype.Card = {};
    Animation.prototype.Player = {};
    Animation.prototype.General = {};



    Animation.prototype.Card.Defend = function (defender) {

        // Original Position and Scale of the defender
        var defenderOrigin = {
            scaleX: defender.scale.y,
            scaleY: defender.scale.x,
            x: defender.x,
            y: defender.y
        };

        var leftShake = { x: defenderOrigin.x - 25 };
        var rightShake = { x: defenderOrigin.x + 25 };
        var speed = 100;

        // Play the defender scream
        Asset.GetSound(Asset.Sound.DEFEND_1).play();

        // Do the tween.
        var shakeTween = CreateJS.Tween.get(defender, { override: false })
        .to(leftShake, speed, CreateJS.Ease.elasticOut)
        .to(rightShake, speed, CreateJS.Ease.elasticOut)
        .to(leftShake, speed, CreateJS.Ease.elasticOut)
        .to(rightShake, speed, CreateJS.Ease.elasticOut)
        .to(leftShake, speed, CreateJS.Ease.elasticOut)
        .to(rightShake, speed, CreateJS.Ease.elasticOut)
        .to(leftShake, speed, CreateJS.Ease.elasticOut)
        .to(rightShake, speed, CreateJS.Ease.elasticOut)
        .to(leftShake, speed, CreateJS.Ease.elasticOut)
        .to(rightShake, speed, CreateJS.Ease.elasticOut)
        .to(leftShake, speed, CreateJS.Ease.elasticOut)
        .to(rightShake, speed, CreateJS.Ease.elasticOut)
        .to(defenderOrigin, speed, CreateJS.Ease.elasticOut)
        .call(function () {
            if (defender.owner == defender.engine.player) {
                defender.interactive = true
            }

        })
    }

    Animation.prototype.Card.Attack = function (attacker, defender, callbacks) {

        // Distance between the cards
        var delta =
            {
                x: defender.x - attacker.x,
                y: defender.y - attacker.y
            }

        // Original Position and Scale of the attacker
        var attackerOrigin = {
            scaleX: attacker.scale.y,
            scaleY: attacker.scale.x,
            x: attacker.x,
            y: attacker.y
        };

        // Original Position and Scale of the defender
        var defenderOrigin = {
            scaleX: defender.scale.y,
            scaleY: defender.scale.x,
            x: defender.x,
            y: defender.y
        };

        // Set interactive to false on both
        attacker.interactive = false;
        // defender.interactive = false;


        // This is the temporary tween object
        var values = attackerOrigin;

        // Change the card to the attacker group
        Asset.GetSound(Asset.Sound.ATTACK_1).play();

        // Swap group to the Attacker Group (Which is top level group)
        attacker.engine.SwapFromToGroup(attacker, (attacker.owner.isPlayer) ? "Card-Player" : "Card-Opponent", "Attacker");

        var attackTween = CreateJS.Tween.get(values, {
            override: false,
            onChange: function onChange(e) {
                attacker.scale.y = values.scaleY;
                attacker.scale.x = values.scaleX;
                attacker.x = values.x;
                attacker.y = values.y;
            }
        })
        // Jump Half Way
        .to(
        {
            scaleX: attacker.scale.y + 1,
            scaleY: attacker.scale.x + 1,
            x: attackerOrigin.x + delta.x,
            y: attackerOrigin.y + (delta.y / 2)
        }, 700)
        // Land on opponent
        .to(
        {
            scaleX: attackerOrigin.scaleX,
            scaleY: attackerOrigin.scaleY,
            x: attackerOrigin.x + delta.x,
            y: attackerOrigin.y + (delta.y / 1.5)
        }, 300)
        // Hits the card, call Defend on the target
        .call(function () {

            // Change health on the object
            callbacks.ChangeHealth();

            // Check alive status
            if (defender.isDead) {
                defender.Animation.Death(defender);
            }
            else {
                defender.Animation.Defend(defender);
            }

            // Check alive status attacker
            if (attacker.isDead) {
                attacker.engine.SwapFromToGroup(attacker, "Attacker", (attacker.owner.isPlayer) ? "Card-Player" : "Card-Opponent");
                CreateJS.Tween.removeTweens(values);
                attacker.Animation.Death(attacker);
            }


        })
        // Wait abit before returning
        .wait(200)

        // Return to origin position.
        .to(
        {
            scaleX: attackerOrigin.scaleX,
            scaleY: attackerOrigin.scaleY,
            x: attackerOrigin.x,
            y: attackerOrigin.y
        }, 150)
        // Animation done, call reset functions flags
        .wait(150)
        .call(function () {

            // Set back to correct group
            attacker.engine.SwapFromToGroup(attacker, "Attacker", (attacker.owner.isPlayer) ? "Card-Player" : "Card-Opponent");

            // Activate the interactive again if its a player
            if (attacker.owner.isPlayer) {
                attacker.interactive = true;
            }
        });

    }



    Animation.prototype.Card.Death = function (card) {
        card.owner.holdingCard = undefined;
        card.inSlot.Reset();

        var values = {
            scaleY: card.scale.y,
            scaleX: card.scale.x,
            x: card.x,
            y: card.y,
            rotation: card.rotation
        }

        // Location of the card
        var xEndpoint = card.owner.engine.conf.width + 200;
        var yEndpoint = undefined;

        // Spins in different direction depending on attacker\defender
        yEndpoint = (card.owner.isPlayer) ? card.owner.engine.conf.height : 0;

        // Execute tween (Move, rotate, scale)
        var deathTween = CreateJS.Tween.get(values, {
            override: false,
            onChange: function onChange(e) {
                card.scale.y = values.scaleY;
                card.scale.x = values.scaleX;
                card.x = values.x;
                card.y = values.y;
                card.rotation = values.rotation;
            }
        })
        .to(
        {
            scaleX: 3,
            scaleY: 3,
            rotation: 10,
            x: xEndpoint,
            y: yEndpoint
        }, 1000)
        .call(function () {
            card.owner.cardManager.RemoveCard(card);
        })

        Asset.GetSound(Asset.Sound.DEFEND_1).play();

    }

    Animation.prototype.Card.MoveBack = function (c) {

        c.OrderOriginalPosition();
        var target =
            {
                x: c.position.originX,
                y: c.position.originY
            }

        CreateJS.Tween.get(c, { override: true })
            .to(target, 1000, CreateJS.Ease.elasticOut)
            .call(onComplete);

        function onComplete() {
            // Set Mount variable to true
            //c.interactive = true;
            c._awaitRequest = false;
        }
    }

    Animation.prototype.Card.MoveTo = function () {

    }

    Animation.prototype.Card.PutIn = function () {
        // TODO
    }


    Animation.prototype.General.Heal = Animation.prototype.General.GainAttack = function (healthText) {

        var originalScale =
            {
                scaleX: healthText._originalScale.y,
                scaleY: healthText._originalScale.x
            }


        var values =
            {
                scaleX: healthText.scale.y + 5,
                scaleY: healthText.scale.x + 5
            }



        CreateJS.Tween.get(values, {
            override: true,
            onChange: function onChange(e) {
                healthText.scale.y = values.scaleY;
                healthText.scale.x = values.scaleX;
            }
        })
        .to(originalScale, 2500, CreateJS.Ease.linear)

    }

    Animation.prototype.General.Sacrifice = function (src, tar) {
        src.owner.holdingCard = undefined;
        src.interactive = false;
        src.inSlot.Reset();

        var values = {
            scaleY: src.scale.y,
            scaleX: src.scale.x,
            x: src.x,
            y: src.y,
            rotation: src.rotation
        }

        // Execute tween (Move, rotate, scale)
        var sacrificeTween = CreateJS.Tween.get(values, {
            override: false,
            onChange: function onChange(e) {
                src.scale.y = values.scaleY;
                src.scale.x = values.scaleX;
                src.x = values.x;
                src.y = values.y;
                src.rotation = values.rotation;
            }
        })
        .to(
        {
            scaleX: 0.1,
            scaleY: 0.1,
            rotation: 30,
        }, 2000)
        .to(
        {
            x: tar.x,
            y: tar.y
        }, 1500)
        .to(
        {
            scaleX: 0,
            scaleY: 0,
        }, 1500)
        .call(function () {
            src.owner.cardManager.RemoveCard(src);
        })






    }




    ///////////////////////////////////////////////////////////////////
    ///////////////////////////////////////////////////////////////////
    ///////////////////////////////////////////////////////////////////
    ////////////////////////PLAYER STUFF///////////////////////////////
    ///////////////////////////////////////////////////////////////////
    ///////////////////////////////////////////////////////////////////
    ///////////////////////////////////////////////////////////////////
    ///////////////////////////////////////////////////////////////////

    Animation.prototype.Player.Death = function (player) {



        var die = CreateJS.Tween.get(player, { override: false })
        .to({ rotation: 20 }, 1000, CreateJS.Ease.QuadIn)


        CreateJS.Tween.get(c, { override: true })
           .to(target, 1000, CreateJS.Ease.elasticOut)
           .call(onComplete);

    }




    Animation.prototype.Player.CardAttack = function (attacker, defender, callbacks) {

        // Distance between the cards
        var delta =
            {
                x: defender.x - attacker.x,
                y: defender.y - attacker.y
            }

        // Original Position and Scale of the attacker
        var attackerOrigin = {
            scaleX: attacker.scale.y,
            scaleY: attacker.scale.x,
            x: attacker.x,
            y: attacker.y
        };

        // Original Position and Scale of the defender
        var defenderOrigin = {
            scaleX: defender.scale.y,
            scaleY: defender.scale.x,
            x: defender.x,
            y: defender.y
        };

        // Set interactive to false on both
        attacker.interactive = false;
        // defender.interactive = false;


        // This is the temporary tween object
        var values = attackerOrigin;

        // Change the card to the attacker group
        Asset.GetSound(Asset.Sound.ATTACK_1).play();

        var attackTween = CreateJS.Tween.get(values, {
            override: false,
            onChange: function onChange(e) {
                //attacker.scale.y = values.scaleY; TODO makes portrait WIERD?
                //attacker.scale.x = values.scaleX;
                attacker.x = values.x;
                attacker.y = values.y;
            }
        })
        // Jump Half Way
        .to(
        {
            scaleX: attacker.scale.y + 1,
            scaleY: attacker.scale.x + 1,
            x: attackerOrigin.x + delta.x,
            y: attackerOrigin.y + (delta.y / 2)
        }, 700)
        // Land on opponent
        .to(
        {
            scaleX: attackerOrigin.scaleX,
            scaleY: attackerOrigin.scaleY,
            x: attackerOrigin.x + delta.x,
            y: attackerOrigin.y + (delta.y / 1.5)
        }, 300)
        // Hits the card, call Defend on the target
        .call(function () {

            // Change health on the object
            callbacks.SetHealth();

            // Check alive status
            if (defender.isDead) {
                defender.Animation.Death(defender);
            }
            else {
                defender.Animation.Defend(defender);
            }

            // Check alive status attacker
            if (attacker.isDead) {
                CreateJS.Tween.removeTweens(values);
                attacker.Animation.Death(attacker);
            }


        })
        // Wait abit before returning
        .wait(200)

        // Return to origin position.
        .to(
        {
            scaleX: 0.8,
            scaleY: 0.8,
            x: attackerOrigin.x,
            y: attackerOrigin.y
        }, 150)
        // Animation done, call reset functions flags
        .wait(150)
        .call(function () {

            // Activate the interactive again if its a player
            if (attacker.isPlayer) {
                attacker.interactive = true;
            }
        });

    }


    Animation.prototype.Player.Attack = function (attacker, defender, spriteGroup, callbacks) {

        var sprites = new Object();
        var container = new Pixi.SpriteBatch();

        spriteGroup.addChild(container);

        var yAxisDirection = (attacker.y < defender.y) ? -1 : 1;
        var startY = attacker.y + ((attacker.height / 2) * yAxisDirection * -1) + (15 * yAxisDirection);
        var count = 0;
        var incrementor = 1;
        var width = 50;
        var pause = false;
        var intervalId = setInterval(function () {

            if (!pause) {
                // Create and push the sprite
                var sprite = new Pixi.Sprite.fromImage("/Content/Images/Player/beam.png");
                sprites[count] = sprite;
                container.addChild(sprite);

                // Check if we should invert the incrementor
                if (count % 50 == 0) {
                    incrementor *= -1;
                }

                // Set position and stuff
                width += incrementor;
                sprite.width = width;
                //sprite.rotation = count;
                sprite.height = 5;
                sprite.x = attacker.position.x;
                sprite.anchor = { x: 0.5, y: 0.5 }
                sprite.y = startY

                count += 5;
            }

            for (var index in sprites) {
                var sprite = sprites[index];

                sprite.y -= 5 * yAxisDirection

                if (pause && sprite.width > 0) {
                    sprite.width -= 1;
                    if (sprite.width <= 1) sprite.visible = false;
                }

                // Calculate Distance from Player and beam fragment
                var deltaY = sprite.y - (defender.y + defender.height / 3 * yAxisDirection) - (30 * yAxisDirection);
                deltaY *= (deltaY < 0) ? -1 : 1;

                if (deltaY <= 5) {
                    delete sprites[index];
                    container.removeChild(sprite);
                }


            }

            if ($.isEmptyObject(sprite)) {
                clearInterval(intervalId);
            }

        }, 10);

        // Blink opponent
        var blinkOn = false;
        var opponentBlinkIntId = setInterval(function () {
            if (blinkOn) {
                defender.pPortrait.tint = 0xFF0000;
                blinkOn = false;
            }

            else {
                defender.pPortrait.tint = 0xFFFFFF;
                blinkOn = true;
            }
        }, 200);


        setTimeout(function () {
            pause = true;
            clearInterval(opponentBlinkIntId);
            callbacks.SetHealth();
            defender.pPortrait.tint = 0xFFFFFF;

        }, 5200);

    }




    Animation.prototype.Player.Defend = function (player) {

        var speed = 200;

        // Do the tween.
        var blink = CreateJS.Tween.get(player, { override: false })
        .call(function () { red() })
        .wait(speed)
        .call(function () { none() })
        .wait(speed)
         .call(function () { red() })
        .wait(speed)
        .call(function () { none() })
        .wait(speed)
        .call(function () { red() })
        .wait(speed)
        .call(function () { none() })
        .wait(speed)

        function red() {
            console.log(player);
            player.portrait.tint = 0xFF0000;
        }
        function none() {
            player.portrait.tint = 0xFFFFFF;
        }


    }









    return new Animation();
});