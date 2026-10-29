using System.Net;
using System.Text.RegularExpressions;

namespace Souls.Tests.Integration;

/// <summary>A minimal browser: keeps cookies and submits forms with their antiforgery token.</summary>
public sealed partial class TestBrowser(HttpClient client) : IDisposable
{
    public Dictionary<string, string> Cookies { get; } = [];

    public string CookieHeader => string.Join("; ", Cookies.Select(c => $"{c.Key}={c.Value}"));

    /// <summary>The value of the login cookie, to authenticate WebSockets against the game server.</summary>
    public string? AuthCookie => Cookies.Where(c => c.Key is "souls" or "__Host-souls").Select(c => $"{c.Key}={c.Value}").FirstOrDefault();

    public async Task<HttpResponseMessage> GetAsync(string url)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, url);
        return await SendAsync(request);
    }

    /// <summary>Loads <paramref name="formPage"/> for an antiforgery token, then posts the form to <paramref name="url"/>.</summary>
    public async Task<HttpResponseMessage> PostFormAsync(string formPage, string url, IEnumerable<KeyValuePair<string, string>> fields)
    {
        using var page = await GetAsync(formPage);
        var html = await page.Content.ReadAsStringAsync();
        var token = TokenPattern().Match(html).Groups[1].Value;
        Assert.False(string.IsNullOrEmpty(token), $"No antiforgery token on {formPage} ({page.StatusCode})");

        using var request = new HttpRequestMessage(HttpMethod.Post, url)
        {
            Content = new FormUrlEncodedContent(fields.Append(new("__RequestVerificationToken", token))),
        };
        return await SendAsync(request);
    }

    public async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request)
    {
        if (Cookies.Count > 0)
        {
            request.Headers.Add("Cookie", CookieHeader);
        }

        var response = await client.SendAsync(request);
        if (response.Headers.TryGetValues("Set-Cookie", out var setCookies))
        {
            foreach (var header in setCookies)
            {
                var pair = header.Split(';')[0].Split('=', 2);
                var expired = header.Contains("expires=Thu, 01 Jan 1970", StringComparison.OrdinalIgnoreCase);
                if (expired || pair[1].Length == 0)
                {
                    Cookies.Remove(pair[0]);
                }
                else
                {
                    Cookies[pair[0]] = pair[1];
                }
            }
        }

        return response;
    }

    public async Task RegisterAsync(string name, string password, int playerType = 1, params int[] cards)
    {
        cards = cards.Length > 0 ? cards : [1, 2, 3, 5, 6];
        var fields = new List<KeyValuePair<string, string>>
        {
            new("Form.Username", name),
            new("Form.Password", password),
            new("Form.ConfirmPassword", password),
            new("Form.PlayerType", playerType.ToString(System.Globalization.CultureInfo.InvariantCulture)),
        };
        fields.AddRange(cards.Select(c => new KeyValuePair<string, string>("Form.Cards", c.ToString(System.Globalization.CultureInfo.InvariantCulture))));

        using var response = await PostFormAsync("/Player/Register", "/Player/Register", fields);
        Assert.Equal(HttpStatusCode.Redirect, response.StatusCode);
        Assert.EndsWith("/Player/Login", response.Headers.Location!.ToString(), StringComparison.Ordinal);
    }

    public async Task<HttpResponseMessage> LoginAsync(string name, string password) =>
        await PostFormAsync("/Player/Login", "/Player/Login", [new("Name", name), new("Password", password)]);

    public void Dispose() => client.Dispose();

    [GeneratedRegex("name=\"__RequestVerificationToken\" type=\"hidden\" value=\"([^\"]+)\"")]
    private static partial Regex TokenPattern();
}
