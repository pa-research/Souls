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
    /// A portrait that cannot be loaded (e.g. the Lost Soul's before its art exists) is replaced by the next one:
    /// onFallback(texture) is called with it when that turns out after the texture was handed out.
    CardType.prototype.GetPortraitTexture = function (cardId, portraitUrl, onFallback) {
        var candidates = [];
        if (this.IsSafePortraitUrl(portraitUrl)) candidates.push(portraitUrl);
        if (CardType.prototype.Portrait[cardId]) candidates.push(CardType.prototype.Portrait[cardId]);
        candidates.push(CardType.prototype.Portrait[0]);

        var urls = [];
        for (var i = 0; i < candidates.length; i++) {
            if (urls.indexOf(candidates[i]) === -1 && !Asset.IsBroken(candidates[i])) urls.push(candidates[i]);
        }
        if (urls.length === 0) urls.push(CardType.prototype.Portrait[0]);

        var that = this;
        var texture = Asset.GetTexture(urls[0]);
        if (onFallback && urls.length > 1) {
            Asset.OnBroken(texture, urls[0], function () {
                onFallback(that.GetPortraitTexture(cardId, portraitUrl, onFallback));
            });
        }
        return texture;
    }


    return new CardType();
});
