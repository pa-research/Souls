// Home page feeds. Everything coming from the server or GitHub is inserted as text, except news bodies,
// which are sanitized HTML written by administrators.
(function () {
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

    // An element with an optional class and text, and children appended.
    function el(tag, className, text) {
        var node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;
        for (var i = 3; i < arguments.length; i++) node.appendChild(arguments[i]);
        return node;
    }

    // A link with an icon and a text.
    function link(href, iconName, text, className) {
        var a = el("a", className, undefined, icon(iconName), el("span", "", text));
        a.href = href;
        return a;
    }

    // A feed that fails to load stays as the page has it.
    function getJSON(url, done) {
        fetch(url).then(function (r) { return r.ok ? r.json() : Promise.reject(r.status); }).then(done).catch(function () { });
    }

    // The texts in the page's language are on the lists (data-*).
    var games = document.getElementById("game-stats-feed");
    if (games) {
        var gameTexts = games.dataset;
        getJSON("/Home/GetGames", function (list) {
            if (!list.length) {
                games.appendChild(el("li", "s-muted s-small", gameTexts.empty));
            }
            list.forEach(function (game) {
                var a = link("/Game/Stats/" + encodeURIComponent(game.gameId), game.practice ? "bot" : "swords",
                    window.soulsFormat(gameTexts.vs, game.player1, game.player2));
                if (game.practice) {
                    a.appendChild(el("span", "s-chip ms-auto", gameTexts.practice));
                }
                games.appendChild(el("li", "", undefined, a));
            });
        });
    }

    // The community: who is online, games to watch, players to challenge and the activity feed.
    var community = document.getElementById("community-panel");
    if (community) {
        var communityTexts = community.dataset;
        getJSON("/Home/Community", function (status) {
            community.hidden = false;
            if (status.players !== null) {
                document.getElementById("community-online").textContent = window.soulsFormat(communityTexts.online, status.players);
            }
            var live = document.getElementById("community-live");
            status.live.forEach(function (game) {
                live.appendChild(el("li", "", undefined, link("/Game?watch=" + encodeURIComponent(game.gameId), "eye",
                    window.soulsFormat(communityTexts.watch, game.players[0], game.players[1]))));
            });
            // Free for a game: a challenge link each.
            var idle = document.getElementById("community-idle");
            status.idle.forEach(function (name) {
                idle.appendChild(link("/Game?challenge=" + encodeURIComponent(name), "swords", name, "s-chip"));
            });
            var feed = document.getElementById("community-feed");
            if (!status.feed.length) {
                feed.appendChild(el("li", "s-muted s-small", communityTexts.empty));
            }
            status.feed.forEach(function (line) {
                feed.appendChild(el("li", "", undefined, link("/Player/Profile/" + encodeURIComponent(line.name),
                    line.kind === "tier" ? "crown" : line.kind === "streak" ? "flame" : "deck", line.text)));
            });
        });
    }

    var news = document.querySelector(".news-wrapper");
    if (news) {
        getJSON("/Home/GetNews", function (list) {
            var panel = document.getElementById("news-panel");
            if (panel) panel.hidden = list.length === 0;
            var dates = new Intl.DateTimeFormat(document.documentElement.lang);
            list.forEach(function (item) {
                var body = el("div", "s-news-body");
                body.innerHTML = item.text;
                news.appendChild(el("article", "s-news-item", undefined, el("h3", "", item.title), body,
                    el("div", "s-news-meta", item.author + " · " + dates.format(new Date(item.date)))));
            });
        });
    }

    var services = document.getElementById("services-plugin");
    if (services) {
        var serviceTexts = services.dataset;
        var names = { "Game Server": serviceTexts.gameServer, "Database": serviceTexts.database };
        getJSON("/Home/ServiceStatus", function (status) {
            Object.keys(status).forEach(function (name) {
                var online = status[name];
                var state = el("span", "fw-semibold", online ? serviceTexts.online : serviceTexts.offline);
                state.prepend(el("span", "s-dot " + (online ? "on" : "off")));
                services.appendChild(el("li", "", undefined, el("span", "", names[name] || name), state));
            });
        });
    }

    var github = document.querySelector(".github-feed");
    if (github) {
        var repository = String(github.dataset.repository);
        getJSON("https://api.github.com/repos/" + repository + "/commits?per_page=8", function (commits) {
            var body = document.getElementById("github-feed");
            commits.forEach(function (commit) {
                var message = (commit.commit.message || "").split("\n")[0].substring(0, 70);
                var url = /^https:\/\/github\.com\//.test(commit.html_url) ? commit.html_url : "#";
                var a = link(url, "sparkles", message);
                a.rel = "noopener noreferrer";
                a.target = "_blank";
                body.appendChild(el("li", "", undefined, a));
            });
        });
    }
})();
