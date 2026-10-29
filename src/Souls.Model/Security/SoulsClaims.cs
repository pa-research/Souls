using System.Security.Claims;
using Microsoft.AspNetCore.Authentication.Cookies;
using Souls.Model.Entities;

namespace Souls.Model.Security;

public static class SoulsClaims
{
    /// <summary>Claim holding the raw session token. Only its hash is stored in the database.</summary>
    public const string SessionToken = "souls:sid";

    public const string AdminRole = "Admin";
    public const string PlayerRole = "Player";

    public static ClaimsPrincipal CreatePrincipal(Player player, string sessionToken)
    {
        var identity = new ClaimsIdentity(
        [
            new Claim(ClaimTypes.NameIdentifier, player.Id.ToString(System.Globalization.CultureInfo.InvariantCulture)),
            new Claim(ClaimTypes.Name, player.Name),
            new Claim(ClaimTypes.Role, player.IsAdmin ? AdminRole : PlayerRole),
            new Claim(SessionToken, sessionToken),
        ], CookieAuthenticationDefaults.AuthenticationScheme);
        return new ClaimsPrincipal(identity);
    }

    public static int? GetPlayerId(this ClaimsPrincipal principal) =>
        int.TryParse(principal.FindFirstValue(ClaimTypes.NameIdentifier), out var id) ? id : null;
}
