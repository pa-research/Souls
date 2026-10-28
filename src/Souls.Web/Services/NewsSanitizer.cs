using Ganss.Xss;

namespace Souls.Web.Services;

/// <summary>News posts are HTML written by administrators; only basic formatting survives.</summary>
public sealed class NewsSanitizer
{
    private readonly HtmlSanitizer _sanitizer;

    public NewsSanitizer()
    {
        _sanitizer = new HtmlSanitizer(new HtmlSanitizerOptions
        {
            AllowedTags = new HashSet<string>(["p", "br", "b", "strong", "i", "em", "u", "ul", "ol", "li", "a", "h3", "h4", "blockquote", "img", "span"], StringComparer.OrdinalIgnoreCase),
            AllowedAttributes = new HashSet<string>(["href", "title", "src", "alt"], StringComparer.OrdinalIgnoreCase),
            AllowedSchemes = new HashSet<string>(["https", "http"], StringComparer.OrdinalIgnoreCase),
            UriAttributes = new HashSet<string>(["href", "src"], StringComparer.OrdinalIgnoreCase),
            AllowedCssProperties = new HashSet<string>(StringComparer.OrdinalIgnoreCase),
        });
        _sanitizer.PostProcessNode += (_, e) =>
        {
            if (e.Node is AngleSharp.Html.Dom.IHtmlAnchorElement a)
            {
                a.SetAttribute("rel", "noopener noreferrer nofollow");
            }
        };
    }

    public string Sanitize(string html) => _sanitizer.Sanitize(html);
}
