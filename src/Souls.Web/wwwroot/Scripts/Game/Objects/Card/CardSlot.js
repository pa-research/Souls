define("cardslot", ["pixi", 'asset'], function (pixi, asset) {

    CardSlot = function (x, y, id) {
        //console.log("> CardSlot Class")
        var texture = asset.GetTexture(asset.Textures.CARD_SLOT);
        pixi.Sprite.call(this, texture);

        // Positional
        this.anchor = { x: 0.5, y: 0.5 };
        this.position.x = this.position.originX = x;
        this.position.y = this.position.originY = y;

        // Dimensions
        this.width = 100;
        this.height = 150;

        // Interactive
        this.interactive = true;

        // Custom variables
        this.slotId = id;
        this.card = undefined;
    };

    // Constructor
    CardSlot.prototype = Object.create(pixi.Sprite.prototype);
    CardSlot.prototype.constructor = CardSlot;

    CardSlot.prototype.Reset = function()
    {
        this.card = undefined;
        this.interactive = true;
    }

    CardSlot.prototype.doScaling = function (hovered) {

        if (hovered) {
            this.width = 140;
            this.height = 170;;
        }
        else {
            this.width = 120;
            this.height = 150;
        }
    }

    CardSlot.prototype.Process = function()
    {
        if(!!this.card)
        {
 
            this.visible = false;
        }
        else
        {
            this.visible = true;
        }
    }
     

    return CardSlot;

});