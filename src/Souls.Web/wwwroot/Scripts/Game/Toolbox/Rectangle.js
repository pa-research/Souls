define("toolbox_rectangle", [], function () {

    Rectangle = function () {
    }

    /**
    * Increases the size of the Rectangle object by the specified amounts. The center point of the Rectangle object stays the same, and its size increases to the left and right by the dx value, and to the top and the bottom by the dy value.
    * @method Phaser.Rectangle.inflate
    * @param {Phaser.Rectangle} a - The Rectangle object.
    * @param {number} dx - The amount to be added to the left side of the Rectangle.
    * @param {number} dy - The amount to be added to the bottom side of the Rectangle.
    * @return {Phaser.Rectangle} This Rectangle object.
    */
    Rectangle.prototype.inflate = function (a, dx, dy) {
        a.x -= dx;
        a.width += 2 * dx;
        a.y -= dy;
        a.height += 2 * dy;
        return a;
    };


    /**
    * Determines whether the specified coordinates are contained within the region defined by this Rectangle object.
    * @method Phaser.Rectangle.contains
    * @param {Phaser.Rectangle} a - The Rectangle object.
    * @param {number} x - The x coordinate of the point to test.
    * @param {number} y - The y coordinate of the point to test.
    * @return {boolean} A value of true if the Rectangle object contains the specified point; otherwise false.
    */
    Rectangle.prototype.contains = function (a, x, y) {
        return (x >= a.x && x <= a.right && y >= a.y && y <= a.bottom);
    };

    Rectangle.prototype.containsRaw = function (rx, ry, rw, rh, x, y) {
        return (x >= rx && x <= (rx + rw) && y >= ry && y <= (ry + rh));
    }

    /**
    * Determines whether the first Rectangle object is fully contained within the second Rectangle object.
    * A Rectangle object is said to contain another if the second Rectangle object falls entirely within the boundaries of the first.
    * @method Phaser.Rectangle.containsRect
    * @param {Phaser.Rectangle} a - The first Rectangle object.
    * @param {Phaser.Rectangle} b - The second Rectangle object.
    * @return {boolean} A value of true if the Rectangle object contains the specified point; otherwise false.
    */
    Rectangle.prototype.containsRect = function (a, b) {

        console.log((a.volume === undefined || b.volume === undefined) ? "MISSING VOLUME VARIABLE" : ":)");
        //  If the given rect has a larger volume than this one then it can never contain it
        if (a.volume > b.volume) {
            return false;
        }

        return (a.x >= b.x && a.y >= b.y && a.right <= b.right && a.bottom <= b.bottom);

    };


    /**
    * Determines whether the two Rectangles intersect with each other.
    * This method checks the x, y, width, and height properties of the Rectangles.
    * @method Phaser.Rectangle.intersects
    * @param {Phaser.Rectangle} a - The first Rectangle object.
    * @param {Phaser.Rectangle} b - The second Rectangle object.
    * @param {Phaser.Rectangle} c - Offset X
    * @param {Phaser.Rectangle} d - Offset Y
    * @return {boolean} A value of true if the specified object intersects with this Rectangle object; otherwise false.
    */
    Rectangle.prototype.intersects = function (a, b, c, d) {

        if (typeof (c) === 'undefined') c = 0;
        if (typeof (d) === 'undefined') d = 0;



        a.right = a.x + a.width;             
        a.bottom = a.y + a.height;

        b.right = b.x + b.width;
        b.bottom = b.y + b.height;

        if (a.width <= 0 || a.height <= 0 || b.width <= 0 || b.height <= 0) {
            return false;
        }

        return !(a.right + c.x < b.x + d.x || a.bottom + c.y < b.y + d.y || a.x + + c.x > b.right + d.x || a.y + c.y > b.bottom + d.y);

    };


    Rectangle.prototype.intersectsYAxis = function (a, b, c, d) {

        if (typeof (c) === 'undefined') c = 0;
        if (typeof (d) === 'undefined') d = 0;



        a.right = a.x + a.width / 2;
        a.bottom = a.y + a.height;

        b.right = b.x + b.width;
        b.bottom = b.y + b.height;

        if (a.width <= 0 || a.height <= 0 || b.width <= 0 || b.height <= 0) {
            return false;
        }

        // a.width / 2 
        return !(a.right + c.x < b.x + d.x || a.bottom + c.y < b.y + d.y || a.x + (a.width / 2) + c.x > b.right + d.x || a.y + c.y > b.bottom + d.y);

    };
  

    return Rectangle;

});