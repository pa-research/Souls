define("toolbox", ["toolbox_rectangle"], function (Rectangle) {

    Toolbox = function () {

        console.log("> Toolbox Loaded!");
    }
    Toolbox.prototype.constructor = Toolbox;

    Toolbox.Rectangle = new Rectangle();


    return Toolbox;
});