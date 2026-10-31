// Live player administration through the game server's admin WebSocket (/ws/admin).
// The socket is authenticated by the login cookie; the server only accepts administrators.
(function ($) {
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
        row.find(".player-status")
            .toggleClass("text-success", online)
            .toggleClass("text-danger", !online)
            .text(online ? texts.online : texts.offline);
    }

    socket.onopen = function () {
        send(Request.LOGIN);
        send(Request.ONLINE_USERS);
    };

    socket.onmessage = function (event) {
        var data = JSON.parse(event.data);
        if (data.Type === Request.ONLINE_USERS) {
            var online = {};
            $.each(data.Payload, function (_, id) { online[id] = true; });
            $("#admin-players tbody tr").each(function () {
                var row = $(this);
                setStatus(row, online[row.data("player-id")] === true);
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
        return parseInt($(button).closest("tr").data("player-id"), 10);
    }

    $(".kick").on("click", function () {
        send(Request.KICK_USER, { pId: playerId(this) });
    });

    $(".ban").on("click", function () {
        var until = $(this).closest("tr").find(".ban-until").val();
        if (!until) {
            window.alert(texts.banDate);
            return;
        }
        send(Request.BAN_USER, { pId: playerId(this), until: new Date(until).toISOString() });
    });

    $(".reset").on("click", function () {
        if (window.confirm(texts.reset)) {
            send(Request.RESET, { pId: playerId(this) });
        }
    });
})(jQuery);
