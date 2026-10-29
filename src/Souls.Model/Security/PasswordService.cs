using System.Security.Cryptography;
using System.Text;
using Microsoft.AspNetCore.Identity;
using Microsoft.Extensions.Options;
using Souls.Model.Entities;

namespace Souls.Model.Security;

public enum PasswordCheck
{
    Failed,
    Success,

    /// <summary>The password is correct but stored with a weak/legacy scheme and must be re-hashed.</summary>
    SuccessRehashNeeded,
}

/// <summary>
/// Hashes passwords with PBKDF2 (ASP.NET Core Identity v3 format). Hashes from the original
/// application (unsalted SHA-256 hex) are still accepted once and flagged for re-hashing.
/// </summary>
public sealed class PasswordService
{
    public const int MinLength = 8;
    public const int MaxLength = 128;

    private readonly PasswordHasher<Player> _hasher = new(Options.Create(new PasswordHasherOptions
    {
        CompatibilityMode = PasswordHasherCompatibilityMode.IdentityV3,
        IterationCount = 210_000,
    }));

    public string Hash(string password) => _hasher.HashPassword(null!, password);

    public PasswordCheck Verify(string storedHash, string password)
    {
        if (string.IsNullOrEmpty(storedHash) || string.IsNullOrEmpty(password) || password.Length > MaxLength)
        {
            return PasswordCheck.Failed;
        }

        if (IsLegacySha256(storedHash))
        {
            var computed = Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(password)));
            return CryptographicOperations.FixedTimeEquals(
                Encoding.ASCII.GetBytes(computed),
                Encoding.ASCII.GetBytes(storedHash.ToLowerInvariant()))
                ? PasswordCheck.SuccessRehashNeeded
                : PasswordCheck.Failed;
        }

        try
        {
            return _hasher.VerifyHashedPassword(null!, storedHash, password) switch
            {
                PasswordVerificationResult.Success => PasswordCheck.Success,
                PasswordVerificationResult.SuccessRehashNeeded => PasswordCheck.SuccessRehashNeeded,
                _ => PasswordCheck.Failed,
            };
        }
        catch (FormatException)
        {
            // Unusable hashes (e.g. the system bot account) never verify.
            return PasswordCheck.Failed;
        }
    }

    public static string? ValidatePolicy(string? password) => password switch
    {
        null or "" => "You must input a password",
        { Length: < MinLength } => $"Password must be {MinLength} characters or longer!",
        { Length: > MaxLength } => $"Password must be at most {MaxLength} characters!",
        _ => null,
    };

    private static bool IsLegacySha256(string hash) => hash.Length == 64 && hash.All(char.IsAsciiHexDigit);
}
