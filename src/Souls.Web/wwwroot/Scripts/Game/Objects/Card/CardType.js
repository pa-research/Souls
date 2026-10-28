define("cardtype", ['asset', 'stopwatch'], function (Asset, Stopwatch) {

    CardType = function () {

    }
    CardType.prototype.constructor = CardType;


    CardType.Textures = {
        0: Asset.Textures.CARD_ERROR,
        1: Asset.Textures.CARD_DARKNESS,
        2: Asset.Textures.CARD_VAMPIRIC,
        3: Asset.Textures.CARD_LIGHTBRINGER,
        4: Asset.Textures.CARD_FEROCIOUS,
    }

    CardType.prototype.Portrait =
        {
            0: Asset.Textures.CARD_PORTRAIT_UNKNOWN,
            /*/1: Asset.Textures.CARD_PORTRAIT_ONE,
            2: Asset.Textures.CARD_PORTRAIT_TWO,
            3: Asset.Textures.CARD_PORTRAIT_THREE,
            4: Asset.Textures.CARD_PORTRAIT_FOUR,
            5: Asset.Textures.CARD_PORTRAIT_FIVE,
            6: Asset.Textures.CARD_PORTRAIT_SIX,*/
        }

    CardType.prototype.GetCardTexture = function (cardType) {
        if (!CardType.Textures[cardType])
            console.log("CARD_TYPE TEXTURE DOES NOT EXIST")

        return Asset.GetTexture(CardType.Textures[cardType]);
    }

    CardType.prototype.GetPortraitTexture = function (cardId) {
        if (!CardType.prototype.Portrait[cardId]) {
            console.log("Portrait TEXTURE does not exist! for id: " + cardId)
            return Asset.GetTexture(CardType.prototype.Portrait[0]);
        }

        return Asset.GetTexture(CardType.prototype.Portrait[cardId]);
    }


    CardType.prototype.Abilities =
        {
            "TAUNT": function () {
                //DO LOGIC
            },
            "HEAL": function () {
                // DO LOGICl
            }
        }


    return new CardType();
});

