// Home page feeds. Everything coming from the server or GitHub is inserted as text, except news bodies,
// which are sanitized HTML written by administrators.
(function ($) {
    "use strict";

    function cell(content) {
        return $("<td>").append(content);
    }

    var games = $("#game-stats-feed tbody");
    if (games.length) {
        $.getJSON("/Home/GetGames").done(function (list) {
            $.each(list, function (_, game) {
                var link = $("<a>").attr("href", "/Game/Stats/" + encodeURIComponent(game.gameId)).text(game.player1 + " vs " + game.player2);
                games.append($("<tr>").append(cell(link)));
            });
        });
    }

    var news = $(".news-wrapper");
    if (news.length) {
        $.getJSON("/Home/GetNews").done(function (list) {
            $.each(list, function (_, item) {
                var post = $("<article class='news-item'>");
                post.append($("<div class='news-item-title'>").text(item.title));
                post.append($("<div class='news-item-text'>").html(item.text));
                post.append($("<hr>"));
                post.append($("<div class='news-item-bottom'>").text(item.author + " - " + new Date(item.date).toLocaleString()));
                news.append(post);
            });
        });
    }

    var services = $("#services-plugin tbody");
    if (services.length) {
        $.getJSON("/Home/ServiceStatus").done(function (status) {
            $.each(status, function (name, online) {
                var badge = $("<span class='fw-bold'>").addClass(online ? "text-success" : "text-danger").text(online ? "Online" : "Offline");
                services.append($("<tr>").append(cell(document.createTextNode(name)), cell(badge)));
            });
        });
    }

    var github = $(".github-feed");
    if (github.length) {
        var repository = String(github.data("repository"));
        $.getJSON("https://api.github.com/repos/" + repository + "/commits?per_page=15").done(function (commits) {
            var body = $("#github-feed tbody");
            $.each(commits, function (_, commit) {
                var message = (commit.commit.message || "").split("\n")[0].substring(0, 55);
                var url = /^https:\/\/github\.com\//.test(commit.html_url) ? commit.html_url : "#";
                var link = $("<a>").attr({ href: url, rel: "noopener noreferrer", target: "_blank" }).text(message);
                body.append($("<tr>").append(cell(link), cell(document.createTextNode(commit.commit.committer.name))));
            });
        });
    }
})(jQuery);
