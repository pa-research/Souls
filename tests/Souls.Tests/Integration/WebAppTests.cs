using System.Net;
using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using Souls.Model.Entities;

namespace Souls.Tests.Integration;

[Collection(SoulsCollection.Name)]
public class WebAppTests(SoulsAppFixture app)
{
    private const string Password = "CorrectHorse9!";

    private static string NewName() => "u" + Guid.NewGuid().ToString("N")[..10];

    [Fact]
    public async Task PagesSendSecurityHeaders()
    {
        using var browser = app.CreateBrowser();
        using var response = await browser.GetAsync("/");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var csp = response.Headers.GetValues("Content-Security-Policy").Single();
        Assert.Contains("script-src 'self';", csp, StringComparison.Ordinal);
        Assert.Contains("frame-ancestors 'none'", csp, StringComparison.Ordinal);
        Assert.Equal("nosniff", response.Headers.GetValues("X-Content-Type-Options").Single());
        Assert.Equal("DENY", response.Headers.GetValues("X-Frame-Options").Single());
        Assert.False(response.Headers.Contains("Server"));
    }

    [Theory]
    [InlineData("/Shop")]
    [InlineData("/Game")]
    [InlineData("/Admin/Players")]
    public async Task ProtectedPagesRequireLogin(string url)
    {
        using var browser = app.CreateBrowser();
        using var response = await browser.GetAsync(url);

        Assert.Equal(HttpStatusCode.Redirect, response.StatusCode);
        Assert.StartsWith("http://localhost/Player/Login", response.Headers.Location!.ToString(), StringComparison.Ordinal);
    }

    [Fact]
    public async Task PostsWithoutAntiforgeryTokenAreRejected()
    {
        using var browser = app.CreateBrowser();
        using var request = new HttpRequestMessage(HttpMethod.Post, "/Player/Login")
        {
            Content = new FormUrlEncodedContent([new("Name", SoulsAppFixture.AdminName), new("Password", SoulsAppFixture.AdminPassword)]),
        };
        using var response = await browser.SendAsync(request);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Null(browser.AuthCookie);
    }

    [Fact]
    public async Task RegisterLoginAndShop()
    {
        var name = NewName();
        using var browser = app.CreateBrowser();
        await browser.RegisterAsync(name, Password);

        using var login = await browser.LoginAsync(name, Password);
        Assert.Equal(HttpStatusCode.Redirect, login.StatusCode);
        Assert.NotNull(browser.AuthCookie);

        using var shop = await browser.GetAsync("/Shop");
        Assert.Equal(HttpStatusCode.OK, shop.StatusCode);
        Assert.Contains(name, await shop.Content.ReadAsStringAsync(), StringComparison.Ordinal);

        // A new player has no soul coins, Christine costs 3.
        using var buy = await browser.PostFormAsync("/Shop", "/Shop/Buy", [new("cardId", "4")]);
        Assert.Equal(HttpStatusCode.Redirect, buy.StatusCode);
        using var after = await browser.GetAsync("/Shop");
        Assert.Contains("You cannot afford Christine!", await after.Content.ReadAsStringAsync(), StringComparison.Ordinal);

        var playerId = await app.WithDbAsync(db => db.Players.Where(p => p.Name == name).Select(p => p.Id).SingleAsync());
        await app.WithDbAsync(db => db.Players.Where(p => p.Id == playerId).ExecuteUpdateAsync(s => s.SetProperty(p => p.Money, 3)));

        using var buy2 = await browser.PostFormAsync("/Shop", "/Shop/Buy", [new("cardId", "4")]);
        using var buy3 = await browser.PostFormAsync("/Shop", "/Shop/Buy", [new("cardId", "4")]);
        var (money, owns) = await app.WithDbAsync(async db => (
            await db.Players.Where(p => p.Id == playerId).Select(p => p.Money).SingleAsync(),
            await db.PlayerCards.CountAsync(pc => pc.PlayerId == playerId && pc.CardId == 4)));
        Assert.Equal(0, money);
        Assert.Equal(1, owns);
    }

    [Fact]
    public async Task DeckBuilderUpgradesAndQuests()
    {
        var name = NewName();
        using var browser = app.CreateBrowser();
        await browser.RegisterAsync(name, Password);
        using (await browser.LoginAsync(name, Password))
        {
        }

        var playerId = await app.WithDbAsync(db => db.Players.Where(p => p.Name == name).Select(p => p.Id).SingleAsync());

        // The automatic deck: the five starter cards, four copies each.
        using var deck = await browser.GetAsync("/Deck");
        var deckHtml = await deck.Content.ReadAsStringAsync();
        Assert.Contains("<span id=\"deck-total\">20</span>", deckHtml, StringComparison.Ordinal);
        Assert.Contains("automatic deck", deckHtml, StringComparison.Ordinal);

        // Invalid decks are refused: too many copies, cards not owned, wrong size.
        foreach (var counts in new[] { "1:5,2:4,3:4,5:4,6:3", "1:4,2:4,3:4,5:4,4:4", "1:4,2:4" })
        {
            using var bad = await browser.PostFormAsync("/Deck", "/Deck/Save", Counts(counts));
            Assert.Equal(HttpStatusCode.Redirect, bad.StatusCode);
            Assert.Equal(0, await app.WithDbAsync(db => db.DeckCards.CountAsync(d => d.PlayerId == playerId)));
        }

        using var good = await browser.PostFormAsync("/Deck", "/Deck/Save", Counts("1:4,2:4,3:4,5:4,6:4"));
        Assert.Equal(20, await app.WithDbAsync(db => db.DeckCards.Where(d => d.PlayerId == playerId).SumAsync(d => d.Count)));
        using var saved = await browser.GetAsync("/Deck");
        Assert.Contains("You play with your own deck.", await saved.Content.ReadAsStringAsync(), StringComparison.Ordinal);

        // Upgrading an owned card costs coins and adds a level (+1/+1), at most to level 3.
        using var poor = await browser.PostFormAsync("/Shop", "/Shop/Upgrade", [new("cardId", "6")]);
        Assert.Equal(1, await app.WithDbAsync(db => db.PlayerCards.Where(pc => pc.PlayerId == playerId && pc.CardId == 6).Select(pc => pc.Level).SingleAsync()));
        await app.WithDbAsync(db => db.Players.Where(p => p.Id == playerId).ExecuteUpdateAsync(s => s.SetProperty(p => p.Money, 100)));
        for (var i = 0; i < 3; i++)
        {
            using var upgrade = await browser.PostFormAsync("/Shop", "/Shop/Upgrade", [new("cardId", "6")]);
            Assert.Equal(HttpStatusCode.Redirect, upgrade.StatusCode);
        }

        var (level, money) = await app.WithDbAsync(async db => (
            await db.PlayerCards.Where(pc => pc.PlayerId == playerId && pc.CardId == 6).Select(pc => pc.Level).SingleAsync(),
            await db.Players.Where(p => p.Id == playerId).Select(p => p.Money).SingleAsync()));
        Assert.Equal(3, level);
        Assert.Equal(100 - (1 + 2) - (1 + 4), money); // Bobby costs 1: level 1->2 for 3, 2->3 for 5
        using var shop = await browser.GetAsync("/Shop");
        Assert.Contains("Owned &middot; level 3", await shop.Content.ReadAsStringAsync(), StringComparison.Ordinal);

        // Three daily quests on the home page; the leaderboard lists players by rating.
        using var home = await browser.GetAsync("/");
        var homeHtml = await home.Content.ReadAsStringAsync();
        Assert.Contains("Daily Quests", homeHtml, StringComparison.Ordinal);
        Assert.Equal(3, await app.WithDbAsync(db => db.PlayerQuests.CountAsync(q => q.PlayerId == playerId)));
        Assert.Contains("Top Players", homeHtml, StringComparison.Ordinal);

        static IEnumerable<KeyValuePair<string, string>> Counts(string spec) => spec.Split(',')
            .Select(pair => pair.Split(':'))
            .Select(p => new KeyValuePair<string, string>($"count[{p[0]}]", p[1]));
    }

    [Theory]
    [InlineData("bot", Password, "That username is reserved")]
    [InlineData("<script>", Password, "Usernames are 3-20 letters")]
    [InlineData("validname1", "short", "Password must be 8 characters or longer!")]
    public async Task RegistrationIsValidated(string name, string password, string error)
    {
        using var browser = app.CreateBrowser();
        using var response = await browser.PostFormAsync("/Player/Register", "/Player/Register",
        [
            new("Form.Username", name), new("Form.Password", password), new("Form.ConfirmPassword", password), new("Form.PlayerType", "1"),
            new("Form.Cards", "1"), new("Form.Cards", "2"), new("Form.Cards", "3"), new("Form.Cards", "5"), new("Form.Cards", "6"),
        ]);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Contains(WebUtility.HtmlEncode(error), await response.Content.ReadAsStringAsync(), StringComparison.Ordinal);
    }

    [Fact]
    public async Task RegistrationRequiresFiveStarterCards()
    {
        using var browser = app.CreateBrowser();
        using var response = await browser.PostFormAsync("/Player/Register", "/Player/Register",
        [
            new("Form.Username", NewName()), new("Form.Password", Password), new("Form.ConfirmPassword", Password), new("Form.PlayerType", "1"),
            new("Form.Cards", "1"), new("Form.Cards", "2"), new("Form.Cards", "3"), new("Form.Cards", "5"), new("Form.Cards", "4"),
        ]);

        Assert.Contains("You must select 5 starter cards!", await response.Content.ReadAsStringAsync(), StringComparison.Ordinal);
    }

    [Fact]
    public async Task WrongPasswordsAreRejectedWithoutRevealingAccounts()
    {
        using var browser = app.CreateBrowser();
        using var wrongPassword = await browser.LoginAsync(SoulsAppFixture.AdminName, "not-the-password");
        using var unknownUser = await browser.LoginAsync(NewName(), "not-the-password");

        Assert.Contains("Invalid username or password.", await wrongPassword.Content.ReadAsStringAsync(), StringComparison.Ordinal);
        Assert.Contains("Invalid username or password.", await unknownUser.Content.ReadAsStringAsync(), StringComparison.Ordinal);
        Assert.Null(browser.AuthCookie);
    }

    [Fact]
    public async Task BotAccountCannotLogIn()
    {
        using var browser = app.CreateBrowser();
        using var response = await browser.LoginAsync("BOT", "nopass");
        Assert.Null(browser.AuthCookie);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task LegacyPasswordHashesAreUpgradedOnLogin()
    {
        var name = NewName();
        var legacy = Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes("password1")));
        await app.WithDbAsync(db =>
        {
            db.Players.Add(new Player { Name = name, NormalizedName = Player.Normalize(name), Password = legacy, PlayerTypeId = 1 });
            return db.SaveChangesAsync();
        });

        using var browser = app.CreateBrowser();
        using var response = await browser.LoginAsync(name, "password1");

        Assert.Equal(HttpStatusCode.Redirect, response.StatusCode);
        var stored = await app.WithDbAsync(db => db.Players.Where(p => p.Name == name).Select(p => p.Password).SingleAsync());
        Assert.NotEqual(legacy, stored);
        Assert.StartsWith("AQAAAA", stored, StringComparison.Ordinal);
    }

    [Fact]
    public async Task LogoutRevokesTheSessionServerSide()
    {
        var name = NewName();
        using var browser = app.CreateBrowser();
        await browser.RegisterAsync(name, Password);
        using var _ = await browser.LoginAsync(name, Password);
        var stolenCookie = browser.AuthCookie!;

        using var logout = await browser.PostFormAsync("/Shop", "/Player/Logout", []);
        Assert.Equal(HttpStatusCode.Redirect, logout.StatusCode);

        // Replaying the old cookie no longer works.
        using var attacker = app.CreateBrowser();
        var pair = stolenCookie.Split('=', 2);
        attacker.Cookies[pair[0]] = pair[1];
        using var response = await attacker.GetAsync("/Shop");
        Assert.Equal(HttpStatusCode.Redirect, response.StatusCode);
    }

    [Fact]
    public async Task AdminPagesRequireTheAdminRole()
    {
        var name = NewName();
        using var player = app.CreateBrowser();
        await player.RegisterAsync(name, Password);
        using var _ = await player.LoginAsync(name, Password);
        using var forbidden = await player.GetAsync("/Admin/Players");
        Assert.Equal(HttpStatusCode.Redirect, forbidden.StatusCode);
        Assert.Contains("/Home/AccessDenied", forbidden.Headers.Location!.ToString(), StringComparison.Ordinal);

        using var admin = app.CreateBrowser();
        using var __ = await admin.LoginAsync(SoulsAppFixture.AdminName, SoulsAppFixture.AdminPassword);
        using var allowed = await admin.GetAsync("/Admin/Players");
        Assert.Equal(HttpStatusCode.OK, allowed.StatusCode);
        Assert.Contains(name, await allowed.Content.ReadAsStringAsync(), StringComparison.Ordinal);
    }

    [Fact]
    public async Task NewsIsSanitized()
    {
        using var admin = app.CreateBrowser();
        using var _ = await admin.LoginAsync(SoulsAppFixture.AdminName, SoulsAppFixture.AdminPassword);
        using var post = await admin.PostFormAsync("/Admin/NewsEditor", "/Admin/NewsEditor",
            [new("Post.Title", "Patch notes"), new("Post.Text", "<b>New cards!</b><script>alert(1)</script><img src=x onerror=alert(1)>")]);
        Assert.Equal(HttpStatusCode.Redirect, post.StatusCode);

        using var browser = app.CreateBrowser();
        using var response = await browser.GetAsync("/Home/GetNews");
        var news = JsonNode.Parse(await response.Content.ReadAsStringAsync())!.AsArray();
        var text = (string)news.First(n => (string?)n!["title"] == "Patch notes")!["text"]!;
        Assert.Contains("<b>New cards!</b>", text, StringComparison.Ordinal);
        Assert.DoesNotContain("script", text, StringComparison.Ordinal);
        Assert.DoesNotContain("onerror", text, StringComparison.Ordinal);
    }

    [Fact]
    public async Task UploadsOnlyAcceptImages()
    {
        using var admin = app.CreateBrowser();
        using var _ = await admin.LoginAsync(SoulsAppFixture.AdminName, SoulsAppFixture.AdminPassword);
        using var page = await admin.GetAsync("/Admin/CardEditor");
        var token = System.Text.RegularExpressions.Regex.Match(await page.Content.ReadAsStringAsync(), "name=\"__RequestVerificationToken\" type=\"hidden\" value=\"([^\"]+)\"").Groups[1].Value;

        async Task<HttpResponseMessage> Upload(byte[] data, string fileName)
        {
            var content = new MultipartFormDataContent();
            var file = new ByteArrayContent(data);
            file.Headers.ContentType = new MediaTypeHeaderValue("image/png");
            content.Add(file, "file", fileName);
            var request = new HttpRequestMessage(HttpMethod.Post, "/Admin/Upload") { Content = content };
            request.Headers.Add("X-CSRF-TOKEN", token);
            return await admin.SendAsync(request);
        }

        using var html = await Upload("<html><script>alert(1)</script></html>"u8.ToArray(), "evil.png");
        Assert.Equal(HttpStatusCode.BadRequest, html.StatusCode);

        byte[] png = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 1, 2, 3];
        using var ok = await Upload(png, "../../portrait.png");
        Assert.Equal(HttpStatusCode.OK, ok.StatusCode);
        var url = (string)JsonNode.Parse(await ok.Content.ReadAsStringAsync())!["data"]!;
        Assert.Matches("^/Images/Uploaded/[0-9a-f]{32}\\.png$", url);

        using var image = await admin.GetAsync(url);
        Assert.Equal("image/png", image.Content.Headers.ContentType!.MediaType);
        Assert.Equal(png, await image.Content.ReadAsByteArrayAsync());
    }

    [Fact]
    public async Task CardEditorRejectsArbitraryPortraitPaths()
    {
        using var admin = app.CreateBrowser();
        using var _ = await admin.LoginAsync(SoulsAppFixture.AdminName, SoulsAppFixture.AdminPassword);
        using var response = await admin.PostFormAsync("/Admin/CardEditor", "/Admin/CardEditor",
        [
            new("Card.Name", "Evil"), new("Card.Cost", "1"), new("Card.Attack", "1"), new("Card.Health", "1"), new("Card.Armor", "0"),
            new("Card.Level", "2"), new("Card.VendorPrice", "1"), new("Card.RaceId", "1"), new("Card.Portrait", "/../appsettings.json"),
        ]);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Contains("Upload a portrait or use one of the built-in portraits.", await response.Content.ReadAsStringAsync(), StringComparison.Ordinal);
        Assert.False(await app.WithDbAsync(db => db.Cards.AnyAsync(c => c.Name == "Evil")));
    }
}
