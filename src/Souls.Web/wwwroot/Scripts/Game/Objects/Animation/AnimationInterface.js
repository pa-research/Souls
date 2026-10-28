/*
 * This Class defines a interface for Animations. 
 * It gives a abstract set of function which will give all objects 
 * a common Animation set
 */
define("iAnimation", ["jquery"], function ($) {

    Interface = function()
    {
        return {
            Death: undefined, // Death animation
            Attack: undefined, // Attack animation
            MoveBack: undefined, // Move back to original position
            MoveTo: undefined, // Move to a location
            PutIn: undefined, // Put in object
            Defend: undefined,
            Heal: undefined,
            Sacrifice: undefined,
            GainAttack: undefined
        };
    }

    Interface.prototype.constructor = Interface;



    return Interface;

});