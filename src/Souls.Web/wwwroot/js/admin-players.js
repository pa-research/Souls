// Live player administration through the game server's admin WebSocket (/ws/admin).
// The socket is authenticated by the login cookie; the server only accepts administrators.
(function () {
    "use strict";

    var Request = { LOGIN: 1, ONLINE_USERS: 2, BAN_USER: 5, KICK_USER: 6, RESET: 7 };
    var url = (location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/ws/admin";
    var socket = new WebSocket(url);
    var queue = [];
    // The texts in the page's language are on the table (data-*).
    var texts = document.getElementById("admin-players").dataset;

    function send(type, payload) {
        queue.push(JSON.stringify({ Type: type, Payload: payload || {} }));
        flush();
    }

    function flush() {
        while (socket.readyState === WebSocket.OPEN && queue.length > 0) {
            socket.send(queue.shift());
        }
    }

    function setStatus(row, online) {
        var status = row.querySelector(".player-status");
        if (!status) return;
        status.classList.toggle("text-success", online);
        status.classList.toggle("text-body-secondary", !online);
        status.textContent = online ? texts.online : texts.offline;
    }

    socket.onopen = function () {
        send(Request.LOGIN);
        send(Request.ONLINE_USERS);
    };

    socket.onmessage = function (event) {
        var data = JSON.parse(event.data);
        if (data.Type === Request.ONLINE_USERS) {
            var online = {};
            for (var key in data.Payload) online[data.Payload[key]] = true;
            document.querySelectorAll("#admin-players tbody tr").forEach(function (row) {
                setStatus(row, online[row.dataset.playerId] === true);
            });
        } else if (data.Type === 98) {
            window.alert(data.Payload);
        }
    };

    socket.onclose = function () {
        console.log("Admin socket closed");
    };

    setInterval(function () { send(Request.ONLINE_USERS); }, 5000);

    function playerId(button) {
        return parseInt(button.closest("tr").dataset.playerId, 10);
    }

    function onClick(selector, handler) {
        document.querySelectorAll(selector).forEach(function (button) { button.addEventListener("click", handler); });
    }

    onClick(".kick", function () {
        send(Request.KICK_USER, { pId: playerId(this) });
    });

    onClick(".ban", function () {
        var until = this.closest("tr").querySelector(".ban-until").value;
        if (!until) {
            window.alert(texts.banDate);
            return;
        }
        send(Request.BAN_USER, { pId: playerId(this), until: new Date(until).toISOString() });
    });

    onClick(".reset", function () {
        if (window.confirm(texts.reset)) {
            send(Request.RESET, { pId: playerId(this) });
        }
    });
})();
