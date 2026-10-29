// Home page feeds. Everything coming from the server or GitHub is inserted as text, except news bodies,
// which are sanitized HTML written by administrators.
(function ($) {
    "use strict";

    var SVG = "http://www.w3.org/2000/svg";

    function icon(name) {
        var svg = document.createElementNS(SVG, "svg");
        svg.setAttribute("class", "s-icon");
        svg.setAttribute("aria-hidden", "true");
        var use = document.createElementNS(SVG, "use");
        use.setAttribute("href", "/img/icons.svg#i-" + name);
        svg.appendChild(use);
        return svg;
    }

    var games = $("#game-stats-feed");
    if (games.length) {
        $.getJSON("/Home/GetGames").done(function (list) {
            if (!list.length) {
                games.append($("<li class='s-muted s-small'>").text("No games yet. Be the first!"));
            }
            $.each(list, function (_, game) {
                var link = $("<a>").attr("href", "/Game/Stats/" + encodeURIComponent(game.gameId));
                link.append(icon(game.practice ? "bot" : "swords"));
                link.append($("<span>").text(game.player1 + " vs " + game.player2));
                if (game.practice) {
                    link.append($("<span class='s-chip ms-auto'>").text("Practice"));
                }
                games.append($("<li>").append(link));
            });
        });
    }

    var news = $(".news-wrapper");
    if (news.length) {
        $.getJSON("/Home/GetNews").done(function (list) {
            $.each(list, function (_, item) {
                var post = $("<article class='s-news-item'>");
                post.append($("<h3>").text(item.title));
                post.append($("<div class='s-news-body'>").html(item.text));
                post.append($("<div class='s-news-meta'>").text(item.author + " · " + new Date(item.date).toLocaleDateString()));
                news.append(post);
            });
        });
    }

    var services = $("#services-plugin");
    if (services.length) {
        $.getJSON("/Home/ServiceStatus").done(function (status) {
            $.each(status, function (name, online) {
                var state = $("<span class='fw-semibold'>").text(online ? "Online" : "Offline")
                    .prepend($("<span class='s-dot'>").addClass(online ? "on" : "off"));
                services.append($("<li>").append($("<span>").text(name), state));
            });
        });
    }

    var github = $(".github-feed");
    if (github.length) {
        var repository = String(github.data("repository"));
        $.getJSON("https://api.github.com/repos/" + repository + "/commits?per_page=8").done(function (commits) {
            var body = $("#github-feed");
            $.each(commits, function (_, commit) {
                var message = (commit.commit.message || "").split("\n")[0].substring(0, 70);
                var url = /^https:\/\/github\.com\//.test(commit.html_url) ? commit.html_url : "#";
                var link = $("<a>").attr({ href: url, rel: "noopener noreferrer", target: "_blank" });
                link.append(icon("sparkles"), $("<span>").text(message));
                body.append($("<li>").append(link));
            });
        });
    }
})(jQuery);
