// Rules text and target kinds rendered by the server into the page config (see docs/game-protocol.md).
// Everything shown to the player (ability, race, hero power and keyword texts) comes from here instead of being
// hard-coded in the client. Only the target kinds have a fallback, so targeting keeps working on an older page.
define('rules', ['conf'], function (Conf) {

    var rules = Conf.rules || {};

    // Fallback target kinds (same as GameRules.AbilityTargets / PowerTargets on the server).
    var FALLBACK_ABILITY_TARGETS = {
        1: ['friendlyCard', 'ownHero'], // Heal
        2: ['friendlyCard', 'ownHero'], // Sacrifice
        5: ['enemyCard'],               // Paralyze
        7: ['friendlyCard', 'ownHero'], // Harden
        8: ['enemyCard', 'enemyHero'],  // Burn
        18: ['enemyCard', 'enemyHero']  // Drain
    };
    var FALLBACK_POWER_TARGETS = {
        1: ['enemyCard', 'enemyHero'],
        2: ['enemyCard', 'enemyHero'],
        3: ['friendlyCard', 'ownHero'],
        4: []
    };

    // Card rarity (card JSON "rarity").
    var RARITY = { 1: 'common', 2: 'rare', 3: 'epic', 4: 'legendary' };

    // UseAbility / HeroPower "type" of each target kind.
    var TARGET_TYPE = { friendlyCard: 0, ownHero: 1, enemyHero: 2, enemyCard: 3 };

    var TARGET_LABEL = {
        friendlyCard: 'a friendly card',
        ownHero: 'your hero',
        enemyHero: 'the enemy hero',
        enemyCard: 'an enemy card'
    };

    function lookup(table, id) {
        if (!table || id === undefined || id === null) return null;
        var entry = table[String(id)];
        return entry || null;
    }

    function Rules() { }

    Rules.prototype.TargetType = TARGET_TYPE;

    /// {name, text, activated, targets} of an ability, or null.
    Rules.prototype.Ability = function (abilityId) {
        return lookup(rules.abilities, abilityId);
    };

    /// "common", "rare", "epic" or "legendary" (card JSON "rarity" 1-4), or null.
    Rules.prototype.Rarity = function (rarity) {
        return RARITY[Number(rarity)] || null;
    };

    /// {name, text} of a race, or null.
    Rules.prototype.Race = function (raceId) {
        return lookup(rules.races, raceId);
    };

    /// {name, text, cost, targets} of the hero power of a class, or null.
    Rules.prototype.HeroPower = function (heroType) {
        return lookup(rules.heroPowers, heroType);
    };

    /// {name, attack, health, armor, mana, race} of a class, or null.
    Rules.prototype.HeroType = function (heroType) {
        return lookup(rules.heroTypes, heroType);
    };

    /// A keyword text (summoningSick, paralyzed, armor, fatigue, burned, ward) or "".
    Rules.prototype.Keyword = function (key) {
        return (rules.keywords && typeof rules.keywords[key] === 'string') ? rules.keywords[key] : '';
    };

    /// Whether an ability is used by dragging from the card to a target. cardActivated: the card JSON's own
    /// "ability.activated", used when the page config does not know the ability.
    Rules.prototype.IsActivated = function (abilityId, cardActivated) {
        var ability = this.Ability(abilityId);
        if (ability) return !!ability.activated;
        if (cardActivated !== undefined && cardActivated !== null) return !!cardActivated;
        return !!FALLBACK_ABILITY_TARGETS[abilityId];
    };

    /// What an activated ability can target ("friendlyCard", "ownHero", "enemyHero", "enemyCard").
    Rules.prototype.AbilityTargets = function (abilityId) {
        var ability = this.Ability(abilityId);
        if (ability && ability.targets && ability.targets.length !== undefined) return ability.targets.slice();
        return (FALLBACK_ABILITY_TARGETS[abilityId] || []).slice();
    };

    /// What the hero power of a class can target; an empty list means it needs no target.
    Rules.prototype.PowerTargets = function (heroType) {
        var power = this.HeroPower(heroType);
        if (power && power.targets && power.targets.length !== undefined) return power.targets.slice();
        return (FALLBACK_POWER_TARGETS[heroType] || []).slice();
    };

    Rules.prototype.PowerCost = function (heroType) {
        var power = this.HeroPower(heroType);
        return (power && typeof power.cost === 'number') ? power.cost : 2;
    };

    /// "a friendly card or your hero"
    Rules.prototype.DescribeTargets = function (kinds) {
        var labels = [];
        for (var i = 0; i < kinds.length; i++) {
            if (TARGET_LABEL[kinds[i]]) labels.push(TARGET_LABEL[kinds[i]]);
        }
        if (labels.length === 0) return 'no target';
        if (labels.length === 1) return labels[0];
        return labels.slice(0, -1).join(', ') + ' or ' + labels[labels.length - 1];
    };

    Rules.prototype.MaxHandCards = function () {
        return typeof rules.maxHandCards === 'number' ? rules.maxHandCards : 10;
    };

    Rules.prototype.DeckSize = function () {
        return typeof rules.deckSize === 'number' ? rules.deckSize : 20;
    };

    return new Rules();
});
