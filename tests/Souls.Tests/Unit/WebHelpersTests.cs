using Souls.Web.Services;

namespace Souls.Tests.Unit;

public class WebHelpersTests
{
    [Fact]
    public void NewsSanitizerKeepsFormattingAndRemovesScripts()
    {
        var html = new NewsSanitizer().Sanitize(
            "<b>bold</b><script>alert(1)</script><img src=x onerror=alert(1)><a href=\"javascript:alert(1)\">x</a><a href=\"https://example.com\">ok</a>");

        Assert.Contains("<b>bold</b>", html, StringComparison.Ordinal);
        Assert.DoesNotContain("script", html, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("onerror", html, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("javascript:", html, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("rel=\"noopener noreferrer nofollow\"", html, StringComparison.Ordinal);
    }

    [Fact]
    public void ImagesAreDetectedFromContent()
    {
        Assert.Equal("image/png", ImageValidator.DetectContentType([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00]));
        Assert.Equal("image/jpeg", ImageValidator.DetectContentType([0xFF, 0xD8, 0xFF, 0xE0]));
        Assert.Equal("image/gif", ImageValidator.DetectContentType("GIF89a..."u8));
        Assert.Null(ImageValidator.DetectContentType("<svg onload=alert(1)>"u8));
        Assert.Null(ImageValidator.DetectContentType([]));
    }
}
