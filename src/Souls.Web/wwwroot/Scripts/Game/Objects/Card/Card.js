define("card", [
    'pixi',
    'asset',
    'stopwatch',
    'messages',
    'conf',
    'animation',
    'cardtype',
    'iAnimation',
    'rules',
    'hud',
    'heropower'], function (pixi, asset, StopWatch, Message, Conf, Animation, CardType, AnimationInterface, Rules, Hud, HeroPower) {

        // Size of the card face on screen (the frame textures are scaled to this).
        var FACE_WIDTH = 150;
        var FACE_HEIGHT = 210;
        var LONG_PRESS_MS = 450;
        var LONG_PRESS_SLOP = 30;

        // Spells: a targeted spell is lifted this far out of the hand while the player aims from it; a spell without a
        // target is cast by dropping it (or, after a click, clicking) anywhere in this part of the stage, the board.
        var SPELL_LIFT = 150;
        var HOVER_SCALE = 2.2;
        // A zoomed hand card stays whole on the screen: no further left than this (its half width at HOVER_SCALE).
        var HOVER_MIN_X = FACE_WIDTH / 2 * HOVER_SCALE + 6;
        var BOARD = { left: 300, right: 1620, top: 260, bottom: 860 };

        // Colours of the abilities (by id): the effects of the events, and the gem of a spell.
        var ABILITY_COLOR = {
            1: 0x4cff6a,  // Heal
            2: 0xa569bd,  // Sacrifice
            4: 0xb07cff,  // Summon
            5: 0x5aa9ff,  // Paralyze
            7: 0xb8c4cf,  // Harden
            8: 0xff7a1a,  // Burn
            10: 0xffd36b, // Ward
            11: 0xff5a3a, // Fury
            12: 0x7dff4a, // Venom
            13: 0xffc04d, // Rally
            14: 0x7fd1ff, // Insight
            15: 0xff6a1a, // Inferno
            16: 0x6dff7a, // Regenerate
            17: 0xff8c3a, // Grow
            18: 0xd0104a, // Drain
            19: 0xb07cff, // Brood
            20: 0xff9f43  // Empower
        };

        // Places on the race frame, in the frame texture's pixels (330 x 450) from its centre: the face's children are
        // laid out in these (the face sprite scales them down with the texture).
        var NAME_X = -4, NAME_Y = -158, NAME_WIDTH = 160;   // the name banner, between the cost gem and the race emblem
        var BOX_Y = 101, BOX_WIDTH = 226, BOX_HEIGHT = 70;  // the text box under the portrait
        var GEM_Y = 58;                                     // where the portrait meets the text box
        // The dark body of the frame (without the corner emblems), in card coordinates.
        var BODY_HALF_WIDTH = 64, BODY_HALF_HEIGHT = 93;

        // Rarity: gem colours (light, mid, dark) and the edge of epic and legendary cards.
        var GEM_COLORS = {
            1: [0xf4f1ea, 0xa39e93, 0x5b574f],
            2: [0xbfe4ff, 0x2f8de4, 0x123b73],
            3: [0xf1d4ff, 0xa24ff0, 0x45136e],
            4: [0xfff3c4, 0xff9d1c, 0x7a3a00]
        };
        var RARITY_EDGE = {
            3: { glow: 0xb26bff, edge: 0x9b4de0, light: 0xe7c6ff },
            4: { glow: 0xffb02e, edge: 0xd99a1e, light: 0xfff0b8 }
        };
        var WARD_COLOR = 0xffd36b;

        /// The race whose frame a card wears: its own, or Darkness for a token without one (the Lost Soul), as the 3D
        /// client paints it; 0 (the error frame) otherwise.
        function FrameRace(card) {
            return card.race || (card.token ? 1 : 0);
        }

        /// Sets a label only when its text changes (re-rendering a text is not free).
        function SetLabel(label, value) {
            var text = String(value);
            if (label.text !== text) label.setText(text);
        }

        var measure = document.createElement('canvas').getContext('2d');
        function TextWidth(text, font) {
            measure.font = font;
            return measure.measureText(text).width;
        }

        /// Breaks a text into lines no wider than width (a single long word stays on its own line).
        function WrapLines(text, font, width) {
            var words = String(text).split(/\s+/);
            var lines = [];
            var line = '';
            for (var i = 0; i < words.length; i++) {
                if (!words[i]) continue;
                var test = line ? line + ' ' + words[i] : words[i];
                if (line && TextWidth(test, font) > width) {
                    lines.push(line);
                    line = words[i];
                }
                else {
                    line = test;
                }
            }
            if (line) lines.push(line);
            return lines;
        }

        /// The first lines of a text, the last one cut with an ellipsis when the text goes on.
        function Clip(lines, count, font, width) {
            if (lines.length <= count) return lines;
            var kept = lines.slice(0, count);
            var last = kept[count - 1] + '…';
            while (last.length > 1 && TextWidth(last, font) > width) last = last.slice(0, -2) + '…';
            kept[count - 1] = last;
            return kept;
        }

        /// Sets a text's style and content and renders it at once, so its size is known. Returns its height.
        function Render(label, text, style) {
            label.setStyle(style);
            label.setText(text);
            label.updateText();
            label.dirty = false;
            return label.texture.frame.height;
        }

        /// A rounded rectangle path (Pixi 1.5 has none); used with lineStyle and/or beginFill.
        function RoundRect(g, x, y, w, h, r) {
            var points = [];
            var corners = [[x + w - r, y + r, -Math.PI / 2], [x + w - r, y + h - r, 0], [x + r, y + h - r, Math.PI / 2], [x + r, y + r, Math.PI]];
            for (var c = 0; c < corners.length; c++) {
                for (var i = 0; i <= 4; i++) {
                    var a = corners[c][2] + (Math.PI / 2) * (i / 4);
                    points.push(corners[c][0] + Math.cos(a) * r, corners[c][1] + Math.sin(a) * r);
                }
            }
            g.moveTo(points[0], points[1]);
            for (var p = 2; p < points.length; p += 2) g.lineTo(points[p], points[p + 1]);
            g.lineTo(points[0], points[1]);
        }

        function Polygon(g, points) {
            g.moveTo(points[0], points[1]);
            for (var i = 2; i < points.length; i += 2) g.lineTo(points[i], points[i + 1]);
            g.lineTo(points[0], points[1]);
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
            this.rarity = 0; // 1 common, 2 rare, 3 epic, 4 legendary
            this.flavor = '';
            this.ward = false;
            this.spell = false; // card JSON "kind": "spell" (cast from the hand, never on the board)
            this.faceKey = null;

            // Setup the card layout / graphics
            this.SetupFrontCard(this);
            this.SetupBackCard(this);
            this.SetupRarity();
            this.addChild(this.rarityBack);
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
        Card.ABILITY_COLOR = ABILITY_COLOR;

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
                // The printed ability ("Burn 3"): laid out in the text box with the rules text
                this.abilityLabel = String(text.ability);
                this.UpdateFace();
            }
            if (text.name && text.name !== this.name) {
                this.name = text.name;
                this.FitName();
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
            var oldFrame = FrameRace(this);
            var oldPortrait = this.portraitUrl;

            if (json.id !== undefined && json.id !== null) this.id = json.id;
            if (json.race !== undefined) this.race = json.race ? json.race.id : 0;
            if (json.race) this.raceName = json.race.name;
            if (json.ability !== undefined) {
                // {id, name, value, label ("Burn 3", printed on the face), text (rules text with the card's numbers), activated}
                var ability = json.ability;
                var rules = ability ? Rules.Ability(ability.id) : null;
                this.abilityId = ability ? ability.id : undefined;
                this.abilityName = ability ? (ability.name || (rules && rules.name) || undefined) : undefined;
                this.abilityLabel = ability ? (ability.label || this.abilityName) : undefined;
                this.abilityText = ability && typeof ability.text === 'string' ? ability.text : undefined;
                this.abilityActivated = ability && ability.activated !== undefined && ability.activated !== null ? !!ability.activated : undefined;
            }
            if (json.portrait) this.portraitUrl = json.portrait;
            if (json.rarity !== undefined && json.rarity !== null) this.rarity = ToNumber(json.rarity, 0);
            if (json.flavor !== undefined) this.flavor = json.flavor ? String(json.flavor) : '';
            if (json.kind !== undefined) this.spell = json.kind === 'spell';
            if (json.ward !== undefined) this.ward = !!json.ward;
            if (json.maxHealth !== undefined && json.maxHealth !== null) this.maxHealth = ToNumber(json.maxHealth, this.maxHealth);
            if (json.armor !== undefined && json.armor !== null) this.armor = ToNumber(json.armor, 0);
            if (json.level !== undefined && json.level !== null) this.level = ToNumber(json.level, 1);
            if (json.paralyzed !== undefined) this.paralyzed = !!json.paralyzed;
            if (json.taunt !== undefined) this.taunt = !!json.taunt;
            if (json.token !== undefined) this.token = !!json.token;
            if (json.hasAttacked !== undefined) this.hasAttacked = !!json.hasAttacked;
            if (json.canAct !== undefined) this.canAct = !!json.canAct;

            this.SetText({
                health: json.health,
                attack: json.attack,
                name: json.name,
                cost: json.cost
            });

            if (this.maxHealth === undefined && typeof this.health === 'number') this.maxHealth = this.health;

            // Text box and rarity (only re-rendered when they change).
            if (json.ability !== undefined || json.flavor !== undefined || json.token !== undefined || json.rarity !== undefined || json.kind !== undefined) {
                this.UpdateFace();
            }

            // Art: the frame follows the race, the portrait the card (or its own portrait URL).
            if (this.frontCard && oldFrame !== FrameRace(this)) {
                this.frontCard.setTexture(CardType.GetCardTexture(FrameRace(this)));
                this.frontCard.width = FACE_WIDTH;
                this.frontCard.height = FACE_HEIGHT;
            }
            if (this.portrait && (oldId !== this.id || oldPortrait !== this.portraitUrl)) {
                this.SetPortrait();
            }

            this.RefreshVisuals();
        }

        /// The portrait of the card; a portrait that cannot be loaded is replaced by the card's config portrait or the
        /// unknown portrait (see CardType.GetPortraitTexture).
        Card.prototype.SetPortrait = function () {
            var that = this;
            var token = this.portraitToken = (this.portraitToken || 0) + 1;
            function Show(texture) {
                if (that.portraitToken !== token) return; // another portrait was asked for since
                that.portrait.setTexture(texture);
                that.portrait.width = 236;
                that.portrait.height = 167;
            }
            function Use(texture) {
                if (texture.baseTexture.hasLoaded) {
                    Show(texture);
                    return;
                }
                // Still loading: the card keeps its current art until it has. (Pixi 1.5 would size the sprite by the
                // 1 x 1 frame of a texture that is still loading, and its canvas renderer throws on an image that
                // failed.) The listener stays: removing it while the event is dispatched would skip other listeners.
                texture.addEventListener('update', function () {
                    if (texture.baseTexture.hasLoaded) Show(texture);
                });
            }
            Use(CardType.GetPortraitTexture(this.id, this.portraitUrl, Use));
        }

        /// <summary>
        /// The name on the banner: as large as it fits (40 px down to 24), else on two lines, centred.
        /// </summary>
        Card.prototype.FitName = function () {
            var label = this.texts.name;
            if (!label || !label.setStyle) return;
            var name = String(this.name === undefined || this.name === null ? '' : this.name);
            var size, text = name, font;
            for (size = 40; size >= 24; size -= 2) {
                font = size + "px Arial";
                if (TextWidth(name, font) <= NAME_WIDTH) break;
            }
            if (size < 24 && name.indexOf(' ') !== -1) {
                // Two lines (at most 22 px, so both fit the banner), split where they come out most even.
                var words = name.split(' ');
                var best = null;
                for (var i = 1; i < words.length; i++) {
                    var a = words.slice(0, i).join(' '), b = words.slice(i).join(' ');
                    var wide = Math.max(TextWidth(a, "10px Arial"), TextWidth(b, "10px Arial"));
                    if (!best || wide < best.wide) best = { wide: wide, text: a + "\n" + b };
                }
                text = best.text;
                size = Math.max(18, Math.min(22, Math.floor(10 * NAME_WIDTH / best.wide)));
            }
            else if (size < 24) {
                size = 22;
            }
            Render(label, text, { font: size + "px Arial", fill: "black", align: "center" });
        }

        /// <summary>
        /// The text box: the ability as printed ("Burn 3", "Rally +1") with its rules text under it in a smaller font
        /// when both fit; cards without an ability show their flavor text in italics. Also draws the rarity.
        /// </summary>
        Card.prototype.UpdateFace = function () {
            var label = this.abilityLabel || '';
            var rulesText = this.abilityText || '';
            var flavor = this.flavor || '';
            var key = [label, rulesText, flavor, this.token, this.rarity, this.spell, this.abilityId].join('|');
            if (key === this.faceKey) return;
            this.faceKey = key;

            var txtLabel = this.texts.ability;
            var txtRules = this.txtRules;
            var txtFlavor = this.txtFlavor;
            txtRules.visible = false;
            txtFlavor.visible = false;
            txtLabel.visible = false;

            if (label) {
                this.ability = label;
                // Label and rules text, from roomy to tight; the label alone when the rules text fits nowhere.
                var options = rulesText ? [
                    { label: 30, rules: 14, lines: 2 },
                    { label: 28, rules: 12, lines: 2 },
                    { label: 24, rules: 12, lines: 3 }
                ] : [];
                var placed = false;
                for (var i = 0; i < options.length && !placed; i++) {
                    var o = options[i];
                    var rulesFont = o.rules + "px Arial";
                    var lines = WrapLines(rulesText, rulesFont, BOX_WIDTH);
                    if (lines.length > o.lines) continue;
                    var labelHeight = Render(txtLabel, label, { font: FitSize(label, o.label, 18, "px Arial") + "px Arial", fill: "#1b130b", align: "center" });
                    var rulesHeight = Render(txtRules, lines.join("\n"), { font: rulesFont, fill: "#2b2118", align: "center" });
                    if (labelHeight + rulesHeight > BOX_HEIGHT) continue;
                    var top = BOX_Y - (labelHeight + rulesHeight) / 2;
                    txtLabel.anchor = { x: 0.5, y: 0 };
                    txtLabel.position.y = top;
                    txtRules.position.y = top + labelHeight;
                    txtRules.visible = true;
                    placed = true;
                }
                if (!placed) {
                    Render(txtLabel, label, { font: FitSize(label, 34, 18, "px Arial") + "px Arial", fill: "#1b130b", align: "center" });
                    txtLabel.anchor = { x: 0.5, y: 0.5 };
                    txtLabel.position.y = BOX_Y;
                }
                txtLabel.visible = true;
            }
            else if (flavor) {
                this.ability = ' ';
                var flavorOptions = [{ size: 16, lines: 3 }, { size: 14, lines: 4 }, { size: 13, lines: 4, clip: true }];
                for (var f = 0; f < flavorOptions.length; f++) {
                    var fo = flavorOptions[f];
                    var flavorFont = "italic " + fo.size + "px Georgia, 'Times New Roman', serif";
                    var flavorLines = WrapLines(flavor, flavorFont, BOX_WIDTH);
                    if (flavorLines.length > fo.lines && !fo.clip) continue;
                    var height = Render(txtFlavor, Clip(flavorLines, fo.lines, flavorFont, BOX_WIDTH).join("\n"),
                        { font: flavorFont, fill: "#3a2d20", align: "center" });
                    if (height > BOX_HEIGHT && !fo.clip) continue;
                    break;
                }
                txtFlavor.visible = true;
            }
            else {
                // Vanilla card without flavor text, or a token.
                this.ability = this.token ? 'Token' : ' ';
                Render(txtLabel, this.ability, { font: "34px Arial", fill: "#1b130b", align: "center" });
                txtLabel.anchor = { x: 0.5, y: 0.5 };
                txtLabel.position.y = BOX_Y;
                txtLabel.visible = true;
            }

            this.DrawRarity();

            // A spell has no attack or health: its frame shows the spell gem instead.
            this.spellMark.visible = this.spell;
            this.txtAttack.visible = this.txtHealth.visible = !this.spell;
            this.spellMark.clear();
            if (this.spell) DrawSpellMark(this.spellMark, ABILITY_COLOR[this.abilityId] || 0xd9c2ff);
        }

        /// The largest font size (from max down to min) at which a one-line text fits the text box.
        function FitSize(text, max, min, unit) {
            for (var size = max; size > min; size -= 2) {
                if (TextWidth(text, size + unit) <= BOX_WIDTH) return size;
            }
            return min;
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
            this.frontCard = new pixi.Sprite(CardType.GetCardTexture(FrameRace(this)));
            this.frontCard.anchor = { x: 0.5, y: 0.5 };
            this.frontCard.height = FACE_HEIGHT;
            this.frontCard.width = FACE_WIDTH;


            // Card Image
            this.portrait = new pixi.Sprite(asset.GetTexture(asset.Textures.CARD_PORTRAIT_UNKNOWN)); // until its own art has loaded
            this.portrait.anchor = { x: 0.5, y: 0.5 };
            this.portrait.width = 236;
            this.portrait.height = 167;
            this.portrait.x = 0;
            this.portrait.y = -31;
            this.SetPortrait();
            this.frontCard.addChild(this.portrait);

            // Spells: the band with the spell gem over the attack and health gems (drawn in UpdateFace)
            this.spellMark = new pixi.Graphics();
            this.spellMark.visible = false;
            this.frontCard.addChild(this.spellMark);

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

            // Rarity gem where the portrait meets the text box (drawn in DrawRarity)
            this.rarityGem = new pixi.Graphics();
            this.rarityGem.y = GEM_Y;
            this.rarityGem.visible = false;

            // Text box: the ability label ("Burn 3"), its rules text, or the flavor text (laid out in UpdateFace)
            var txtAbility = new pixi.Text(" ", { font: "34px Arial", fill: "#1b130b", align: "center" });
            txtAbility.anchor = { x: 0.5, y: 0.5 };
            txtAbility.position.x = 0;
            txtAbility.position.y = BOX_Y;
            this.texts.ability = txtAbility;

            this.txtRules = new pixi.Text(" ", { font: "14px Arial", fill: "#2b2118", align: "center" });
            this.txtRules.anchor = { x: 0.5, y: 0 };
            this.txtRules.visible = false;

            this.txtFlavor = new pixi.Text(" ", { font: "italic 16px Georgia, serif", fill: "#3a2d20", align: "center" });
            this.txtFlavor.anchor = { x: 0.5, y: 0.5 };
            this.txtFlavor.position.y = BOX_Y;
            this.txtFlavor.visible = false;

            // Name on the banner (sized in FitName)
            var txtName = new pixi.Text(String(this.name), { font: "40px Arial", fill: "black", align: 'center' });
            txtName.anchor = { x: 0.5, y: 0.5 };
            txtName.x = NAME_X;
            txtName.y = NAME_Y;
            this.texts.name = txtName;

            // Legendary: a small golden crown over the name banner
            this.crown = new pixi.Graphics();
            DrawCrown(this.crown);
            this.crown.visible = false;

            this.frontCard.addChild(this.rarityGem);
            this.frontCard.addChild(this.txtHealth);
            this.frontCard.addChild(txtCost);
            this.frontCard.addChild(this.txtAttack);
            this.frontCard.addChild(txtAbility);
            this.frontCard.addChild(this.txtRules);
            this.frontCard.addChild(this.txtFlavor);
            this.frontCard.addChild(txtName);
            this.frontCard.addChild(this.crown);
            this.FitName();
        }

        /// Behind the face: the gilded (legendary) or violet (epic) edge around the frame (drawn in DrawRarity).
        Card.prototype.SetupRarity = function () {
            this.rarityBack = new pixi.Graphics();
            this.rarityBack.visible = false;
        }

        /// Draws the rarity gem (not on tokens), and the edge and crown of epic and legendary cards.
        Card.prototype.DrawRarity = function () {
            var rarity = this.rarity;
            var gem = this.rarityGem;
            gem.clear();
            gem.visible = !!GEM_COLORS[rarity] && !this.token;
            if (gem.visible) DrawGem(gem, rarity);

            var back = this.rarityBack;
            var edge = RARITY_EDGE[rarity];
            back.clear();
            back.visible = !!edge;
            if (edge) {
                var w = BODY_HALF_WIDTH, h = BODY_HALF_HEIGHT;
                // Soft glow, the metal edge and a light rim on it.
                back.lineStyle(0, 0, 0);
                back.beginFill(edge.glow, 0.22);
                RoundRect(back, -w - 9, -h - 9, 2 * w + 18, 2 * h + 18, 14);
                back.endFill();
                back.beginFill(edge.edge, 1);
                RoundRect(back, -w - 5, -h - 5, 2 * w + 10, 2 * h + 10, 10);
                back.endFill();
                back.lineStyle(1.5, edge.light, 0.95);
                RoundRect(back, -w - 3.5, -h - 3.5, 2 * w + 7, 2 * h + 7, 8);
            }
            this.crown.visible = rarity === 4 && !this.token;
        }

        /// The gem (in frame texture pixels): a faceted pentagon in the rarity's colours.
        function DrawGem(g, rarity) {
            var c = GEM_COLORS[rarity];
            var light = c[0], mid = c[1], dark = c[2];
            var T = [0, -17], R = [15, -4], BR = [9, 15], BL = [-9, 15], L = [-15, -4], IL = [-6, -2], IR = [6, -2];
            function Facet(color, alpha, pts) {
                g.beginFill(color, alpha);
                var flat = [];
                for (var i = 0; i < pts.length; i++) flat.push(pts[i][0], pts[i][1]);
                Polygon(g, flat);
                g.endFill();
            }
            g.lineStyle(0, 0, 0);
            if (rarity >= 3) {
                // Epic and legendary gems glow.
                g.beginFill(mid, rarity === 4 ? 0.22 : 0.16);
                g.drawCircle(0, 0, 30);
                g.endFill();
                g.beginFill(mid, 0.3);
                g.drawCircle(0, 0, 22);
                g.endFill();
            }
            Facet(light, 1, [L, IL, T]);
            Facet(light, 0.85, [IL, IR, T]);
            Facet(mid, 1, [T, IR, R]);
            Facet(mid, 1, [L, BL, IL]);
            Facet(mid, 1, [IL, IR, BR, BL]);
            Facet(dark, 1, [IR, R, BR]);
            // Outline and facet edges
            g.lineStyle(2.5, 0x1b130b, 1);
            Polygon(g, [T[0], T[1], R[0], R[1], BR[0], BR[1], BL[0], BL[1], L[0], L[1]]);
            g.lineStyle(1.2, 0xffffff, 0.55);
            g.moveTo(L[0], L[1]); g.lineTo(IL[0], IL[1]); g.lineTo(T[0], T[1]); g.lineTo(IR[0], IR[1]); g.lineTo(R[0], R[1]);
            g.moveTo(IL[0], IL[1]); g.lineTo(IR[0], IR[1]); g.lineTo(BR[0], BR[1]);
            g.moveTo(IL[0], IL[1]); g.lineTo(BL[0], BL[1]);
        }

        /// The bottom of a spell's frame (in frame texture pixels): a dark band over the attack and health gems of the
        /// race frame, edged in the ability's colour, with a glowing orb and a star of light in the middle.
        function DrawSpellMark(g, color) {
            g.lineStyle(0, 0, 0);
            g.beginFill(0x15110d, 1);
            RoundRect(g, -166, 138, 332, 86, 28);
            g.endFill();
            g.lineStyle(4, color, 0.9);
            RoundRect(g, -158, 145, 316, 72, 22);
            g.lineStyle(0, 0, 0);
            g.beginFill(color, 0.22);
            g.drawCircle(0, 181, 48);
            g.endFill();
            g.beginFill(color, 0.45);
            g.drawCircle(0, 181, 37);
            g.endFill();
            g.lineStyle(3, 0x1b130b, 1);
            g.beginFill(color, 1);
            g.drawCircle(0, 181, 27);
            g.endFill();
            g.lineStyle(0, 0, 0);
            g.beginFill(0xffffff, 0.95);
            Polygon(g, [0, 159, 6, 175, 22, 181, 6, 187, 0, 203, -6, 187, -22, 181, -6, 175]);
            g.endFill();
        }

        /// The legendary crown (in frame texture pixels) over the top edge, centred.
        function DrawCrown(g) {
            g.lineStyle(0, 0, 0);
            g.beginFill(0xffb02e, 0.25);
            g.drawEllipse(0, -207, 40, 18);
            g.endFill();
            g.lineStyle(2.5, 0x4a2a00, 1);
            g.beginFill(0xe9a93a, 1);
            Polygon(g, [-27, -193, -31, -218, -15, -205, 0, -224, 15, -205, 31, -218, 27, -193]);
            g.endFill();
            // Band and shine
            g.lineStyle(0, 0, 0);
            g.beginFill(0xfff0b8, 0.75);
            Polygon(g, [-25, -201, 25, -201, 26, -196, -26, -196]);
            g.endFill();
            g.beginFill(0xc97d0b, 1);
            Polygon(g, [-26, -196, 26, -196, 27, -193, -27, -193]);
            g.endFill();
            // Jewels on the points
            var jewels = [[-31, -218], [0, -224], [31, -218]];
            for (var i = 0; i < jewels.length; i++) {
                g.lineStyle(1.5, 0x4a2a00, 1);
                g.beginFill(0xff4d4d, 1);
                g.drawCircle(jewels[i][0], jewels[i][1], 4);
                g.endFill();
            }
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

        /// Draws the ward around a card face (card coordinates): a soft golden glow, a translucent golden veil, a
        /// bright edge and a sheen across the upper left corner. grow widens it (the break animation).
        function DrawWard(g, grow) {
            var w = FACE_WIDTH / 2 + 5 * (grow || 1), h = FACE_HEIGHT / 2 + 5 * (grow || 1);
            g.lineStyle(10, 0xffc04d, 0.28);
            RoundRect(g, -w - 3, -h - 3, 2 * w + 6, 2 * h + 6, 16);
            g.lineStyle(4, WARD_COLOR, 0.95);
            g.beginFill(0xffe9a0, 0.14);
            RoundRect(g, -w, -h, 2 * w, 2 * h, 13);
            g.endFill();
            g.lineStyle(0, 0, 0);
            g.beginFill(0xffffff, 0.16);
            Polygon(g, [-w + 8, -h + 52, -w + 52, -h + 8, -w + 80, -h + 8, -w + 8, -h + 80]);
            g.endFill();
        }
        Card.DrawWard = DrawWard;
        Card.RoundRect = RoundRect;

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

            // Ward: a golden shimmer over the card, a bright edge and a golden shield low on the left edge
            this.wardMark = new pixi.DisplayObjectContainer();
            var bubble = new pixi.Graphics();
            DrawWard(bubble, 1);
            var wardIcon = new pixi.Graphics();
            DrawShield(wardIcon, 28, 34, 0xd9a21e, 0xfff3c4);
            wardIcon.x = -FACE_WIDTH / 2 - 2;
            wardIcon.y = 38;
            this.wardMark.addChild(bubble);
            this.wardMark.addChild(wardIcon);
            this.wardMark.visible = false;

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
            overlay.addChild(this.wardMark);
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
            // Legendary cards wear the crown on the top edge: their stars go on the top of the portrait.
            this.stars.y = this.rarity === 4 && !this.token ? -FACE_HEIGHT / 2 + 54 : -FACE_HEIGHT / 2 + 4;

            this.tauntFrame.visible = onBoard && this.taunt;
            this.wardMark.visible = onBoard && this.ward;
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

        /// <summary>
        /// The ward breaks (it blocked damage): the ward flares up, bursts into golden shards and is gone.
        /// Returns the duration of the animation.
        /// </summary>
        Card.prototype.BreakWard = function () {
            var engine = this.engine;
            this.ward = false;
            this.RefreshVisuals();
            var group = engine && (engine.getGroup("Effects") || engine.getGroup("Text"));
            if (!group || this.isDead) return 0;

            var home = this.GetHome();
            var flare = new pixi.Graphics();
            DrawWard(flare, 1);
            flare.beginFill(0xfff3c4, 0.45);
            RoundRect(flare, -FACE_WIDTH / 2, -FACE_HEIGHT / 2, FACE_WIDTH, FACE_HEIGHT, 10);
            flare.endFill();
            flare.x = home.x;
            flare.y = home.y;
            group.addChild(flare);
            Animation.Animate(flare, { scaleX: 1.08, scaleY: 1.06 }, 90, engine.CreateJS.Ease.quadOut, function () {
                Animation.Animate(flare, { scaleX: 1.3, scaleY: 1.22, alpha: 0 }, 360, engine.CreateJS.Ease.quadOut, function () {
                    if (flare.parent) flare.parent.removeChild(flare);
                });
            });
            Animation.Fx.Shards(engine, home.x, home.y, WARD_COLOR, 16);
            this.SetFlash(0xfff3c4, 160);
            return 450;
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
            // Spells never go in a slot.
            if (this.pickedUp && !this.inSlot && !this.spell) {

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
            // The face goes below the badge overlay (index 0), the rarity edge below the face.
            if (this.cardFlipped) {
                this.removeChild(this.backCard)
                this.addChildAt(this.frontCard, 0)
                if (this.rarityBack) this.addChildAt(this.rarityBack, 0);
                this.cardFlipped = false;
            }
            else {
                this.removeChild(this.frontCard)
                if (this.rarityBack && this.rarityBack.parent === this) this.removeChild(this.rarityBack);
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

                Animation.PlaySound(asset.Sound.CARD_PICKUP, 0.7);

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
                !this._awaitRequest &&
                !this._armed) {



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
                // Touch has no hover: a tapped hand card (its rules pinned, Tooltip.Pin) zooms the same way.
                var tip = this.engine.tooltip;
                var tapped = !!tip && tip.pinned === this && Date.now() < tip.pinnedUntil;


                // If the mouse intersects
                if (tapped || (mouseIntersects && !(mouse.y < (this.engine.conf.height - 200)))) {

                    if (this.owner._chover != this) {
                        this.OrderOriginalPosition();
                        this.owner._chover = this;
                        this._reset = false;
                        // Scale up
                        this.scale = { x: HOVER_SCALE, y: HOVER_SCALE };

                        // Run tween (x too: a hover may interrupt the tween that sorts the hand). The card stays
                        // pressable: another tween (a card let go goes back to the hand) may override this one, and a
                        // card left non-interactive would hand the next press to the card under it. Lifted so that the
                        // zoomed card ends above the bottom of the screen.
                        this.engine.CreateJS.Tween.get(this, { override: true })
                            .to({ x: Math.max(this.position.originX, HOVER_MIN_X), y: this.position.originY - 120 }, 200, this.engine.CreateJS.Ease.elasticOut);

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
                            this.engine.CreateJS.Tween.get(this, { override: true })
                                .to({ x: this.position.originX, y: this.position.originY }, 500, this.engine.CreateJS.Ease.elasticOut);

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
                    Animation.PlaySound(asset.Sound.CARD_PLAY, 0.8);
                }
                else {
                    Animation.PlaySound(asset.Sound.CARD_PLAY, 0.8);
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

            // The ward shimmers
            if (this.wardMark && this.wardMark.visible) {
                this.wardMark.alpha = 0.78 + 0.22 * Math.sin(Date.now() / 340);
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

        // ---- Spells ----------------------------------------------------------------------------------------------

        /// A spell cast on a target (its ability is activated); the other spells are cast on nothing.
        Card.prototype.TargetedSpell = function () {
            return this.spell && Rules.IsActivated(this.abilityId, this.abilityActivated);
        }

        function OverBoard(point) {
            return point.x >= BOARD.left && point.x <= BOARD.right && point.y >= BOARD.top && point.y <= BOARD.bottom;
        }

        /// <summary>
        /// A spell is let go: cast on the target under the pointer (a spell without one: over the board); after a
        /// click / tap the target is picked next (Arm); anywhere else it goes back to the hand.
        /// </summary>
        Card.prototype.ReleaseSpell = function (click) {
            var cast = this.TargetedSpell() ? !!this.target : (!click && OverBoard(this.engine.conf.mouse));
            if (cast) this.Cast(this.target, this.targetKind);
            else if (click) this.Arm();
            else this.engine.gameService.RequestRelease(this);
            this.target = undefined;
            this.targetKind = undefined;
        }

        /// Sends the spell (UseCard); it waits where it is for the cast (224) or Release (212) when it was refused.
        Card.prototype.Cast = function (target, kind) {
            this.engine.gameService.Request_Spell(this, kind ? Rules.TargetType[kind] : undefined,
                (kind === 'friendlyCard' || kind === 'enemyCard') ? target.cid : -1);
        }

        /// <summary>
        /// Click-then-pick (a click or tap on a spell in the hand): the spell stays lifted and the next press on the
        /// board picks its target, or casts it there when it has none. Any other press, Escape or a right click let it
        /// go back to the hand.
        /// </summary>
        Card.prototype.Arm = function () {
            var that = this;
            var player = this.engine.player;
            if (player.armedSpell) player.armedSpell.Disarm(true);
            player.armedSpell = this;
            this._armed = true;
            this.ScaleUp();
            this.OrderLast();
            this.engine.CreateJS.Tween.get(this, { override: true })
                .to({ x: this.position.originX, y: this.position.originY - SPELL_LIFT }, 220, this.engine.CreateJS.Ease.quadOut);
            this.SetTargetMark(ABILITY_COLOR[this.abilityId] || 0xffffff);
            var kinds = this.TargetedSpell() ? Rules.AbilityTargets(this.abilityId) : [];
            this.engine.ScreenMessage([this.name + ": " + (kinds.length ? "pick " + Rules.DescribeTargets(kinds) : this.touchInput ? "tap the board to cast it" : "click the board to cast it")], 'info');

            this._onPick = function (e) { that.OnPick(e); };
            this._onKey = function (e) { if (e.key === 'Escape') that.Disarm(true); };
            window.addEventListener('mousedown', this._onPick, true);
            window.addEventListener('touchstart', this._onPick, { capture: true, passive: false });
            window.addEventListener('keydown', this._onKey, true);
        }

        /// Ends click-then-pick; back: the spell goes back to the hand (Release).
        Card.prototype.Disarm = function (back) {
            if (!this._armed) return;
            this._armed = false;
            window.removeEventListener('mousedown', this._onPick, true);
            window.removeEventListener('touchstart', this._onPick, { capture: true, passive: false });
            window.removeEventListener('keydown', this._onKey, true);
            var player = this.engine.player;
            if (player && player.armedSpell === this) player.armedSpell = undefined;
            if (player && player.arrow) player.arrow.Reset();
            this.SetTargetMark(null);
            this.ScaleDown();
            if (this.engine.tooltip && this.engine.tooltip.pinned === this) this.engine.tooltip.Pin(null);
            if (back) this.engine.gameService.RequestRelease(this);
        }

        /// A press while armed (see HeroPower.OnPick): on the board it casts on what is under it, else it cancels.
        Card.prototype.OnPick = function (e) {
            if (!this._armed || !this.engine.player) return;
            var touch = e.type === 'touchstart';
            if (e.target !== Hud.Canvas() || (!touch && e.button !== 0)) {
                this.Disarm(true); // another control (it still gets the press) or a right click
                return;
            }

            e.stopPropagation();
            if (e.preventDefault) e.preventDefault();
            if (touch) HeroPower.SwallowTouch(e);
            var point = touch ? ((e.changedTouches && e.changedTouches[0]) || (e.touches && e.touches[0])) : e;
            if (point) this.engine.SetPointer(Hud.ToStage(point.clientX, point.clientY), touch);
            this.engine.player.UpdateAim();

            var target = this.target, kind = this.targetKind;
            var cast = this.TargetedSpell() ? !!target : OverBoard(this.engine.conf.mouse);
            this.target = undefined;
            this.targetKind = undefined;
            this.Disarm(!cast);
            if (cast) this.Cast(target, kind);
            if (touch) this.engine.ClearPointer();
        }


        /// <summary>
        /// Mouse and touch callbacks. Touch: drag a hand card to a slot to play it, drag from a board card to a
        /// target to attack, or hold a board card for a moment (long press) and then drag to use its ability.
        /// </summary>
        Card.prototype.mousedown = Card.prototype.touchstart = function (mouseData) {
            if (this.isDead || this.cardFlipped) return;

            // A hand card may still be moving (popping up under the pointer, sorting): the drag takes over.
            if (!this.inSlot) this.engine.CreateJS.Tween.removeTweens(this);

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

                // Only show cardslots on unslotted cards. A spell with a target is lifted out of the hand and aims
                // from there (the arrow follows the pointer); the others follow the pointer.
                if (!this.inSlot) {
                    if (this.TargetedSpell()) {
                        this.x = this.position.originX;
                        this.y = this.position.originY - SPELL_LIFT;
                    }
                    else {
                        this.x = mouse.x;
                        this.y = mouse.y;
                    }
                    if (!this.spell) this.engine.getGroup("CardSlot-Player").visible = true;
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
            var click = !hadTarget && moved < 20 && (Date.now() - (this._downAt || 0)) < 400;
            var tap = pointer.touch && click;

            this.engine.getGroup("CardSlot-Player").visible = false;

            // Put the card down
            this.PutDown();

            // Reset arrow.
            this.owner.arrow.Reset();

            if (this.spell && !this.inSlot) {
                // Cast it on the target (on the board), pick the target next after a click, or let it go back
                this.ReleaseSpell(click);
            }
            else {
                // Check and execute the card attack
                this.CheckAttack();

                // Check and Request a release of the card
                this.engine.gameService.RequestRelease(this);

                // Check and Request a "UseCard"
                this.engine.gameService.Request_UseCard(this);
            }

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

                // If the card is not in slot (a spell with a target stays lifted, the arrow aims)
                if (!this.inSlot && !this.TargetedSpell()) {
                    this.x = mouse.x;
                    this.y = mouse.y;
                }

            }
        };

        return Card;

    });
