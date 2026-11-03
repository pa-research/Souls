define("socket", [], function () {

    function Socket(url) {
        this.queue = [];
        this.url = url;
    }

    Socket.prototype.connect = function () {
        this.con = new WebSocket(this.url);

        var that = this;
        this.con.onclose = function () {
            console.log("Closed WebSocket");
        };

        this.con.onerror = function (error) {
            console.log('WebSocket Error: ' + error);
        };

        // Messages sent before the socket opened (or while it reconnects) go out in order once it is open.
        this.con.onopen = function () {
            that.flush();
        };
    }

    // Handle messages sent by the server.
    Socket.prototype.onMessage = function (callback) {
        this.con.onmessage = function (event) {
            callback(event);
        };
    }

    Socket.prototype.send = function (data) {
        this.queue.push(JSON.stringify(data));
        this.flush();
    }

    Socket.prototype.flush = function () {
        while (this.con && this.con.readyState === 1 && this.queue.length > 0) {
            this.con.send(this.queue.shift());
        }
    }

    return Socket;
});
