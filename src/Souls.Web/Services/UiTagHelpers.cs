using System.Globalization;
using System.Text.Encodings.Web;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Razor.TagHelpers;
using Souls.Model;

namespace Souls.Web.Services;

/// <summary><c>&lt;s-icon name="coin" /&gt;</c>: an icon from the sprite in /img/icons.svg.</summary>
[HtmlTargetElement("s-icon", TagStructure = TagStructure.WithoutEndTag)]
public sealed partial class IconTagHelper : TagHelper
{
    public string Name { get; set; } = string.Empty;

    /// <summary>Extra CSS classes.</summary>
    public string? Class { get; set; }

    /// <summary>Accessible name; without one the icon is decorative.</summary>
    public string? Label { get; set; }

    public override void Process(TagHelperContext context, TagHelperOutput output)
    {
        if (!IconName().IsMatch(Name))
        {
            throw new InvalidOperationException($"Invalid icon name '{Name}'.");
        }

        output.TagName = "svg";
        output.TagMode = TagMode.StartTagAndEndTag;
        output.Attributes.SetAttribute("class", Class is null ? "s-icon" : $"s-icon {Class}");
        output.Attributes.SetAttribute("focusable", "false");
        if (Label is null)
        {
            output.Attributes.SetAttribute("aria-hidden", "true");
        }
        else
        {
            output.Attributes.SetAttribute("role", "img");
            output.Attributes.SetAttribute("aria-label", Label);
        }

        output.Content.SetHtmlContent($"<use href=\"/img/icons.svg#i-{Name}\"></use>");
    }

    [GeneratedRegex("^[a-z][a-z-]{0,30}$")]
    private static partial Regex IconName();
}

/// <summary><c>&lt;s-rank rank="7" rating="1312" /&gt;</c>: the tier emblem, tier name and rating.</summary>
[HtmlTargetElement("s-rank", TagStructure = TagStructure.WithoutEndTag)]
public sealed class RankTagHelper : TagHelper
{
    public int Rank { get; set; } = 1;
    public int? Rating { get; set; }
    public string? Class { get; set; }

    /// <summary>Only the emblem (with the tier as its accessible name).</summary>
    public bool Compact { get; set; }

    public override void Process(TagHelperContext context, TagHelperOutput output)
    {
        var tier = Ratings.TierOf(Rank);
        var name = HtmlEncoder.Default.Encode(tier.ToString());
        output.TagName = "span";
        output.TagMode = TagMode.StartTagAndEndTag;
        output.Attributes.SetAttribute("class", $"s-rank {tier.Css}{(Class is null ? string.Empty : " " + Class)}");
        var emblem = $"<svg class=\"s-emblem\" focusable=\"false\" {(Compact ? $"role=\"img\" aria-label=\"{name}\"" : "aria-hidden=\"true\"")}><use href=\"/img/icons.svg#emblem\"></use></svg>";
        if (Compact)
        {
            output.Attributes.SetAttribute("title", Rating is { } r ? $"{tier} · {r.ToString(CultureInfo.InvariantCulture)}" : tier.ToString());
            output.Content.SetHtmlContent(emblem);
            return;
        }

        var rating = Rating is { } value ? $" <span class=\"s-rank-rating s-num\">{value.ToString(CultureInfo.InvariantCulture)}</span>" : string.Empty;
        output.Content.SetHtmlContent($"{emblem}<span><span class=\"s-rank-name\">{name}</span>{rating}</span>");
    }
}
