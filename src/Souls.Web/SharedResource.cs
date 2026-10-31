namespace Souls.Web;

/// <summary>
/// The site's own texts: <c>Resources/SharedResource.{language}.resx</c>, read with
/// <c>IStringLocalizer&lt;SharedResource&gt;</c> (<c>@L["..."]</c> in views). The keys are the English texts, so
/// English needs no file. The game's texts (rules, cards, ranks) come from <see cref="Model.Localization.Strings"/>.
/// </summary>
public sealed class SharedResource;
