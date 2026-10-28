define("state", ['pixi'], function (Pixi) {

    function State(hexColor) {
        this.stage = new Pixi.Stage(hexColor);
    }

    State.prototype.Groups = new Array();

    State.prototype.addGroup = function (name, group) {
        this.Groups[name] = group;
        this.stage.addChild(group);
    }

    State.prototype.addGroup = function (name) {
        console.log("> [State]: Creating group " + name);
        this.Groups[name] = new Pixi.DisplayObjectContainer();
        this.stage.addChild(this.Groups[name]);
    }

    State.prototype.getGroup = function (name) {
        return this.Groups[name];
    }

    State.prototype.SwapFromToGroup = function(obj, fromGroup, toGroup)
    {
        this.getGroup(fromGroup).removeChild(obj);
        this.getGroup(toGroup).addChild(obj);
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
            this.addGroup(groupName, new Pixi.DisplayObjectContainer());
        }

        this.Groups[groupName].addChild(sprite);
    }

    State.prototype.OnStart = function () {
        console.error("OnStart function should be overloaded (State.js)")
    }

    State.prototype.OnEnd = function () {
        console.error("OnEnd function should be overloaded (State.js)")
    }

    State.prototype.OnSuspend = function () {
        console.error("OnSuspend function should be overloaded (State.js)")
    }

    return State;


});