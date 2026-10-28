using System.Security.Claims;
using Souls.Model.Security;

namespace Souls.Web.Services;

public static class ClaimsPrincipalExtensions
{
    /// <summary>The id of the signed in player. Only valid on actions that require authentication.</summary>
    public static int RequirePlayerId(this ClaimsPrincipal user) =>
        user.GetPlayerId() ?? throw new InvalidOperationException("No authenticated player");

    public static bool IsAdmin(this ClaimsPrincipal user) => user.IsInRole(SoulsClaims.AdminRole);
}
