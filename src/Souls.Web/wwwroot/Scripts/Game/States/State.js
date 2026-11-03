define("state", ['pixi'], function (Pixi) {

    function State(hexColor) {
        this.stage = new Pixi.Stage(hexColor);
    }

    State.prototype.Groups = new Array();

    State.prototype.addGroup = function (name) {
        console.log("> [State]: Creating group " + name);
        this.Groups[name] = new Pixi.DisplayObjectContainer();
        this.stage.addChild(this.Groups[name]);
    }

    State.prototype.getGroup = function (name) {
        return this.Groups[name];
    }

    /**
    * Adds a PIXI.Sprite to a DisplayCOntainer
    *
    * @property groupName, sprite
    * @type String, PIXI.Sprite
    */
    State.prototype.addChild = function (groupName, sprite) {
        
        // Check if group exists
        if (!this.Groups[groupName])
        {
            console.log("> [State]: Group " + groupName + " does not exist, creating...");
            this.addGroup(groupName);
        }

        this.Groups[groupName].addChild(sprite);
    }

    return State;


});