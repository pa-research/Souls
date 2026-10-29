using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Souls.Model;
using Souls.Model.Security;

namespace Souls.Web.Services;

public sealed record ProfileChip(string Name, int Money, int Rating, int Rank, int Type, string TypeName);

/// <summary>The signed in player's portrait, coins and rank in the top bar.</summary>
public sealed class ProfileChipViewComponent(SoulsDbContext db) : ViewComponent
{
    public async Task<IViewComponentResult> InvokeAsync()
    {
        var playerId = UserClaimsPrincipal.GetPlayerId();
        var chip = playerId is null ? null : await db.Players.AsNoTracking()
            .Where(p => p.Id == playerId)
            .Select(p => new ProfileChip(p.Name, p.Money, p.Rating, p.Rank, p.PlayerTypeId, p.PlayerType!.Name))
            .SingleOrDefaultAsync(HttpContext.RequestAborted);
        return View(chip);
    }
}
