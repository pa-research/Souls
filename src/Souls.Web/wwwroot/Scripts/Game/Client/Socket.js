define("socket", [], function (Messages) {


    function Socket(url) {
        this.msg = new Array();
        this.con;
        this.url = url;

    }
    Socket.constructor = Socket;

    Socket.prototype.connect = function (url) {
        //this.con = new WebSocket("ws://hybel.keel.no:8140");
        this.con = new WebSocket(this.url);

        var that = this;
        this.con.onclose = function (event) {
            console.log("Closed WebSocket");
            that.con.close();
        };

        this.con.onerror = function (error) {
            console.log('WebSocket Error: ' + error);
        };

        this.con.onopen = function (event) {

        };

    }

    // Handle messages sent by the server.
    Socket.prototype.onMessage = function (callback) {
            this.con.onmessage = function (event) {
                callback(event);
            };
    }

    Socket.prototype.send = function (data) {
        // Serialize now: message templates are shared objects that get mutated for the next message.
        this.msg.push(JSON.stringify(data));

        if (this.sendLoop) {
            return;
        }

        var that = this;
        this.sendLoop = setInterval(function () {
            while (that.con && that.con.readyState === 1 && that.con.bufferedAmount == 0 && that.msg.length > 0) {
                that.con.send(that.msg.shift());
            }
        }, 50);
    }

    Socket.prototype.Callbacks = new Array();
    Socket.prototype.RegisterCallback = function (responses, callback) {

        for (var response in responses) {

            if (typeof Socket.prototype.Callbacks[responses[response]] == 'undefined') {
                Socket.prototype.Callbacks[responses[response]] = new Array();
    
            }
            Socket.prototype.Callbacks[responses[response]].push(callback)

        }
    }





    return Socket;
});