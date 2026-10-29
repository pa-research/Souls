define("cardtype", ['asset', 'stopwatch'], function (Asset, Stopwatch) {

    CardType = function () {

    }
    CardType.prototype.constructor = CardType;


    // Card frame by race id (0 = no race, e.g. the Lost Soul token)
    CardType.Textures = {
        0: Asset.Textures.CARD_ERROR,
        1: Asset.Textures.CARD_DARKNESS,
        2: Asset.Textures.CARD_VAMPIRIC,
        3: Asset.Textures.CARD_LIGHTBRINGER,
        4: Asset.Textures.CARD_FEROCIOUS,
    }

    // Portrait by card id. 0 (the Lost Soul token and unknown cards) is the unknown portrait; the other ids are
    // filled in from the page config (every card in the database with its portrait), see Main.js.
    CardType.prototype.Portrait =
        {
            0: Asset.Textures.CARD_PORTRAIT_UNKNOWN
        }

    CardType.prototype.GetCardTexture = function (cardType) {
        if (!CardType.Textures[cardType]) {
            return Asset.GetTexture(CardType.Textures[0]);
        }

        return Asset.GetTexture(CardType.Textures[cardType]);
    }

    /// Only portraits served by this site are used (a path like /Content/Images/...).
    CardType.prototype.IsSafePortraitUrl = function (url) {
        return typeof url === 'string' && url.length > 1 && url.length < 512 &&
            url.charAt(0) === '/' && url.charAt(1) !== '/' && url.indexOf('\\') === -1;
    }

    /// The portrait of a card. The card JSON's own "portrait" wins when it is present (new cards such as 7 and 18
    /// get their art even if the page config does not know them), then the config, then the unknown portrait.
    CardType.prototype.GetPortraitTexture = function (cardId, portraitUrl) {
        if (this.IsSafePortraitUrl(portraitUrl)) {
            return Asset.GetTexture(portraitUrl);
        }

        if (!CardType.prototype.Portrait[cardId]) {
            return Asset.GetTexture(CardType.prototype.Portrait[0]);
        }

        return Asset.GetTexture(CardType.prototype.Portrait[cardId]);
    }


    return new CardType();
});
