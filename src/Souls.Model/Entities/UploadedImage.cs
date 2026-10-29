namespace Souls.Model.Entities;

/// <summary>
/// An image uploaded by an administrator (card portraits). Stored in the database so every web replica can
/// serve it and the containers can keep a read-only file system.
/// </summary>
public class UploadedImage
{
    public const int MaxBytes = 1024 * 1024;

    public Guid Id { get; set; }
    public required string ContentType { get; set; }
    public required byte[] Data { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public int? UploadedById { get; set; }

    /// <summary>Public URL. The extension lets the game's texture loader recognise the format.</summary>
    public string Url => $"/Images/Uploaded/{Id:N}{Extension(ContentType)}";

    public static string Extension(string contentType) => contentType switch
    {
        "image/png" => ".png",
        "image/jpeg" => ".jpg",
        "image/gif" => ".gif",
        _ => ".bin",
    };
}
