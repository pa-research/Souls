using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Npgsql;
using Souls.Model;
using Souls.Model.Hosting;

namespace Souls.Tests.Integration;

[Collection(SoulsCollection.Name)]
public class DataProtectionTests(SoulsAppFixture app)
{
    [Fact]
    public async Task KeysAreStoredEncryptedWithTheCertificate()
    {
        // A database of its own, so the key written here stays out of the key ring the other tests use.
        var database = new NpgsqlConnectionStringBuilder(app.Web.Services.GetRequiredService<IConfiguration>().GetConnectionString("Souls"))
        {
            Database = "dataprotection",
        }.ConnectionString;
        var current = CreateCertificate("Cert-Passw0rd");
        var next = CreateCertificate(null);

        using var writer = BuildHost(database, new() { ["Souls:DataProtection:Certificate"] = current, ["Souls:DataProtection:CertificatePassword"] = "Cert-Passw0rd" });
        await using (var scope = writer.Services.CreateAsyncScope())
        {
            await scope.ServiceProvider.GetRequiredService<SoulsDbContext>().Database.EnsureCreatedAsync();
        }

        var payload = writer.Services.GetDataProtector("test").Protect("secret");

        await using (var scope = writer.Services.CreateAsyncScope())
        {
            var xml = await scope.ServiceProvider.GetRequiredService<SoulsDbContext>().DataProtectionKeys.Select(k => k.Xml).SingleAsync();
            Assert.Contains("<encryptedSecret", xml, StringComparison.Ordinal);
            Assert.DoesNotContain("<masterKey", xml, StringComparison.Ordinal);
        }

        // Another process with the same certificate reads the key from the database.
        using var reader = BuildHost(database, new() { ["Souls:DataProtection:Certificate"] = current, ["Souls:DataProtection:CertificatePassword"] = "Cert-Passw0rd" });
        Assert.Equal("secret", reader.Services.GetDataProtector("test").Unprotect(payload));

        // After a certificate rotation the previous certificate still decrypts the older key.
        using var rotated = BuildHost(database, new()
        {
            ["Souls:DataProtection:Certificate"] = next,
            ["Souls:DataProtection:PreviousCertificate"] = current,
            ["Souls:DataProtection:PreviousCertificatePassword"] = "Cert-Passw0rd",
        });
        Assert.Equal("secret", rotated.Services.GetDataProtector("test").Unprotect(payload));
    }

    private static IHost BuildHost(string connectionString, Dictionary<string, string?> settings)
    {
        settings["ConnectionStrings:Souls"] = connectionString;
        var builder = Host.CreateEmptyApplicationBuilder(new() { EnvironmentName = "Testing" });
        builder.Configuration.AddInMemoryCollection(settings);
        builder.Services.AddSoulsDatabase();
        builder.Services.AddSoulsAuthentication(builder.Configuration);
        return builder.Build();
    }

    /// <summary>A self-signed RSA certificate as a base64 PFX, the way it is mounted as a secret.</summary>
    private static string CreateCertificate(string? password)
    {
        using var rsa = RSA.Create(2048);
        using var certificate = new CertificateRequest("CN=Souls Data Protection test", rsa, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1)
            .CreateSelfSigned(DateTimeOffset.UtcNow, DateTimeOffset.UtcNow.AddDays(1));
        return Convert.ToBase64String(certificate.Export(X509ContentType.Pfx, password));
    }
}
