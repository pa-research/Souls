define("networkBase", ["messages"], function (Message) {

    NetworkBase = function (socket) {
        this.socket = socket;

        // Create what is needed for the network to work
        this.responseAction = new Object();
        this.networkBuffer = NetworkBase.prototype.networkBuffer = new Array();
        this.message = Message;
    }


    ////////////////////////////////////////////////////////////////
    ////////////////////////////////////////////////////////////////
    ////////////////////////////////////////////////////////////////
    //NETWORKBASEHERPDERPFUCKINHERITANCE.
    ////////////////////////////////////////////////////////////////
    NetworkBase.prototype.RegisterResponseAction = function (responseArray, func) {
        for (var response in responseArray) {
            this.responseAction[responseArray[response]] = func;
        }
    }

    NetworkBase.prototype.GetResponseAction = function (responseId) {
        if (!this.responseAction[responseId]) {
            console.log("Could not find RESPONSE!" + responseId)

        }
        return this.responseAction[responseId];
    }


    NetworkBase.prototype.Process = function () {
        if (NetworkBase.prototype.networkBuffer.length > 0) {
            // Get a packet
            var packet = NetworkBase.prototype.networkBuffer.shift();

            if (!!this.GetResponseAction(packet.Type))
                this.GetResponseAction(packet.Type)(packet);
        }

    }

    NetworkBase.prototype.Send = function (json) {
        this.socket.send(json);
    }

    NetworkBase.prototype.Connect = function () {
        this.socket.connect();

        // Recieves all Data from server
        this.socket.onMessage(NetworkBase.prototype.TrafficHandler);
    }


    NetworkBase.prototype.TrafficHandler = function (json) {
        console.log(json);
        NetworkBase.prototype.networkBuffer.push(JSON.parse(json.data));
    }





    return NetworkBase;
});
