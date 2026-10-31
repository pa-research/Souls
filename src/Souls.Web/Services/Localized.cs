using System.Globalization;
using Microsoft.AspNetCore.Localization;
using Souls.Model;
using Souls.Model.Entities;
using Souls.Model.Localization;

namespace Souls.Web.Services;

/// <summary>
/// Game texts in the language of the request (views: <c>@T(GameRules.AbilityName(id))</c>). The site's own texts
/// are in <c>Resources/SharedResource.{language}.resx</c> (see <see cref="SharedResource"/>).
/// </summary>
public static class Localized
{
    /// <summary>The languages the site is available in, English (the default) first.</summary>
    public static IReadOnlyList<CultureInfo> Cultures { get; } = [.. Strings.Languages.Select(CultureInfo.GetCultureInfo)];

    /// <summary>The language of the current request ("en", "nb"), set by the request localization middleware.</summary>
    public static string Language => Strings.LanguageOf(CultureInfo.CurrentUICulture);

    public static string T(GameText text) => text.In(Language);

    /// <summary>A season's name: the default name in the reader's language, a custom one as it is.</summary>
    public static string SeasonName(Season season) => Seasons.NameText(season)?.In(Language) ?? season.Name;

    /// <summary>A language's name in that language ("Norsk bokmål").</summary>
    public static string LanguageName(string language) => Strings.Get(language, "lang.name");

    /// <summary>The cookie that remembers the chosen language (read by <see cref="CookieRequestCultureProvider"/>).</summary>
    public static string CookieName(bool secure) => secure ? "__Host-souls-lang" : "souls-lang";

    public static string CookieValue(string language) => CookieRequestCultureProvider.MakeCookieValue(new RequestCulture(language));
}
