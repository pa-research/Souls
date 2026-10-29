namespace Souls.Web.Services;

/// <summary>Detects the image type from the file content; the client-supplied name and type are ignored.</summary>
public static class ImageValidator
{
    private static readonly byte[] Png = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
    private static readonly byte[] Jpeg = [0xFF, 0xD8, 0xFF];
    private static readonly byte[] Gif87 = "GIF87a"u8.ToArray();
    private static readonly byte[] Gif89 = "GIF89a"u8.ToArray();

    public static string? DetectContentType(ReadOnlySpan<byte> data) =>
        data.StartsWith(Png) ? "image/png"
        : data.StartsWith(Jpeg) ? "image/jpeg"
        : data.StartsWith(Gif87) || data.StartsWith(Gif89) ? "image/gif"
        : null;
}
