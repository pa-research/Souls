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

    // The texts in the page's language are on the lists (data-*).
    var games = $("#game-stats-feed");
    if (games.length) {
        var gameTexts = games[0].dataset;
        $.getJSON("/Home/GetGames").done(function (list) {
            if (!list.length) {
                games.append($("<li class='s-muted s-small'>").text(gameTexts.empty));
            }
            $.each(list, function (_, game) {
                var link = $("<a>").attr("href", "/Game/Stats/" + encodeURIComponent(game.gameId));
                link.append(icon(game.practice ? "bot" : "swords"));
                link.append($("<span>").text(window.soulsFormat(gameTexts.vs, game.player1, game.player2)));
                if (game.practice) {
                    link.append($("<span class='s-chip ms-auto'>").text(gameTexts.practice));
                }
                games.append($("<li>").append(link));
            });
        });
    }

    // The community: who is online, games to watch, players to challenge and the activity feed.
    var community = $("#community-panel");
    if (community.length) {
        var communityTexts = community[0].dataset;
        $.getJSON("/Home/Community").done(function (status) {
            community.prop("hidden", false);
            if (status.players !== null) {
                $("#community-online").text(window.soulsFormat(communityTexts.online, status.players));
            }
            $.each(status.live, function (_, game) {
                var link = $("<a>").attr("href", "/Game?watch=" + encodeURIComponent(game.gameId));
                link.append(icon("eye"), $("<span>").text(window.soulsFormat(communityTexts.watch, game.players[0], game.players[1])));
                $("#community-live").append($("<li>").append(link));
            });
            // Free for a game: a challenge link each.
            $.each(status.idle, function (_, name) {
                $("#community-idle").append($("<a class='s-chip'>").attr("href", "/Game?challenge=" + encodeURIComponent(name)).append(icon("swords"), $("<span>").text(name)));
            });
            var feed = $("#community-feed");
            if (!status.feed.length) {
                feed.append($("<li class='s-muted s-small'>").text(communityTexts.empty));
            }
            $.each(status.feed, function (_, line) {
                var link = $("<a>").attr("href", "/Player/Profile/" + encodeURIComponent(line.name));
                link.append(icon(line.kind === "tier" ? "crown" : line.kind === "streak" ? "flame" : "deck"), $("<span>").text(line.text));
                feed.append($("<li>").append(link));
            });
        });
    }

    var news = $(".news-wrapper");
    if (news.length) {
        $.getJSON("/Home/GetNews").done(function (list) {
            $("#news-panel").prop("hidden", list.length === 0);
            var dates = new Intl.DateTimeFormat(document.documentElement.lang);
            $.each(list, function (_, item) {
                var post = $("<article class='s-news-item'>");
                post.append($("<h3>").text(item.title));
                post.append($("<div class='s-news-body'>").html(item.text));
                post.append($("<div class='s-news-meta'>").text(item.author + " · " + dates.format(new Date(item.date))));
                news.append(post);
            });
        });
    }

    var services = $("#services-plugin");
    if (services.length) {
        var serviceTexts = services[0].dataset;
        var names = { "Game Server": serviceTexts.gameServer, "Database": serviceTexts.database };
        $.getJSON("/Home/ServiceStatus").done(function (status) {
            $.each(status, function (name, online) {
                var state = $("<span class='fw-semibold'>").text(online ? serviceTexts.online : serviceTexts.offline)
                    .prepend($("<span class='s-dot'>").addClass(online ? "on" : "off"));
                services.append($("<li>").append($("<span>").text(names[name] || name), state));
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
