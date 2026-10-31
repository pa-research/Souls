using System.Net;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace Souls.Tests.Integration;

/// <summary>The site in Norwegian: picked by Accept-Language or the language cookie, which the picker sets.</summary>
[Collection(SoulsCollection.Name)]
public partial class LocalizedPagesTests(SoulsAppFixture app)
{
    private const string Password = "CorrectHorse9!";

    private static string NewName() => "l" + Guid.NewGuid().ToString("N")[..10];

    private static async Task<string> PageAsync(TestBrowser browser, string url, string? acceptLanguage = null)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, url);
        if (acceptLanguage is not null)
        {
            request.Headers.Add("Accept-Language", acceptLanguage);
        }

        using var response = await browser.SendAsync(request);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        return await response.Content.ReadAsStringAsync();
    }

    private static string Lang(string html) => HtmlLang().Match(html).Groups[1].Value;

    [Fact]
    public async Task BrowserLanguagePicksThePageLanguage()
    {
        using var browser = app.CreateBrowser();
        var english = await PageAsync(browser, "/");
        Assert.Equal("en", Lang(english));
        Assert.Contains("The Arena Awaits", english, StringComparison.Ordinal);

        var norwegian = await PageAsync(browser, "/", "nb-NO,nb;q=0.9,en;q=0.5");
        Assert.Equal("nb", Lang(norwegian));
        Assert.Contains("Arenaen venter", norwegian, StringComparison.Ordinal);
        Assert.DoesNotContain("The Arena Awaits", norwegian, StringComparison.Ordinal);

        Assert.Equal("en", Lang(await PageAsync(browser, "/", "de-DE,de;q=0.9")));
    }

    [Fact]
    public async Task ThePickedLanguageWinsOverTheBrowser()
    {
        using var browser = app.CreateBrowser();
        using var pick = await browser.PostFormAsync("/", "/Home/Language", [new("language", "nb"), new("returnUrl", "/Player/Login")]);
        Assert.Equal(HttpStatusCode.Redirect, pick.StatusCode);
        Assert.Equal("/Player/Login", pick.Headers.Location!.ToString());

        var login = await PageAsync(browser, "/Player/Login", "en-US,en;q=0.9");
        Assert.Equal("nb", Lang(login));
        Assert.Contains("Gå inn på arenaen", login, StringComparison.Ordinal);

        // Validation messages (data annotations and the controller's) are in Norwegian too.
        using var empty = await browser.PostFormAsync("/Player/Login", "/Player/Login", [new("Name", ""), new("Password", "")]);
        Assert.Contains("Skriv inn brukernavnet!", await empty.Content.ReadAsStringAsync(), StringComparison.Ordinal);
        using var wrong = await browser.PostFormAsync("/Player/Login", "/Player/Login", [new("Name", NewName()), new("Password", "wrong-password")]);
        Assert.Contains("Feil brukernavn eller passord.", await wrong.Content.ReadAsStringAsync(), StringComparison.Ordinal);

        // Unknown languages and foreign return URLs are ignored.
        using var bad = await browser.PostFormAsync("/", "/Home/Language", [new("language", "xx"), new("returnUrl", "https://example.com/")]);
        Assert.Equal("/", bad.Headers.Location!.ToString());
        Assert.Equal("nb", Lang(await PageAsync(browser, "/")));
    }

    [Fact]
    public async Task SignedInPagesAndTheGameRenderInNorwegian()
    {
        var name = NewName();
        using var browser = app.CreateBrowser();
        await browser.RegisterAsync(name, Password);
        using var login = await browser.LoginAsync(name, Password);
        using var pick = await browser.PostFormAsync("/", "/Home/Language", [new("language", "nb"), new("returnUrl", "/")]);

        var home = await PageAsync(browser, "/");
        Assert.Contains("Dagens oppdrag", home, StringComparison.Ordinal);
        Assert.Contains("Bronse III", home, StringComparison.Ordinal);

        var shop = await PageAsync(browser, "/Shop");
        Assert.Equal("nb", Lang(shop));
        Assert.Contains("skade på", shop, StringComparison.Ordinal); // card rules text
        Assert.Contains("Vanlig", shop, StringComparison.Ordinal); // rarity

        foreach (var url in new[] { "/Deck", "/Season", "/Player/Register" })
        {
            Assert.Equal("nb", Lang(await PageAsync(browser, url)));
        }

        // The game page hands the Norwegian table and the localized rules to the clients.
        var game = await PageAsync(browser, "/Game");
        var json = Regex.Match(game, "<script type=\"application/json\" id=\"souls-game-config\">(.*?)</script>", RegexOptions.Singleline).Groups[1].Value;
        var config = JsonNode.Parse(System.Net.WebUtility.HtmlDecode(json))!;
        Assert.Equal("nb", (string?)config["lang"]);
        Assert.Equal("Din tur", (string?)config["strings"]!["g3d.yourTurn"]);
        Assert.Equal("Det er ikke din tur!", (string?)config["strings"]!["error.notYourTurn"]);
        Assert.Equal("Vakt", (string?)config["rules"]!["abilities"]!["3"]!["name"]);
        Assert.Equal("Godt spilt!", (string?)config["rules"]!["emotes"]![1]);
        Assert.Contains(config["languages"]!.AsArray(), l => (string?)l!["code"] == "nb");
    }

    [GeneratedRegex("<html lang=\"([^\"]+)\"")]
    private static partial Regex HtmlLang();
}
