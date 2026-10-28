using System.Security.Cryptography;
using System.Text;
using Souls.Model.Security;

namespace Souls.Tests.Unit;

public class PasswordServiceTests
{
    private readonly PasswordService _passwords = new();

    [Fact]
    public void HashesAreSaltedAndVerify()
    {
        var first = _passwords.Hash("CorrectHorse9!");
        var second = _passwords.Hash("CorrectHorse9!");

        Assert.NotEqual(first, second);
        Assert.Equal(PasswordCheck.Success, _passwords.Verify(first, "CorrectHorse9!"));
        Assert.Equal(PasswordCheck.Failed, _passwords.Verify(first, "wrong-password"));
    }

    [Fact]
    public void LegacyUnsaltedSha256HashesVerifyOnceAndRequestRehash()
    {
        var legacy = Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes("password1")));

        Assert.Equal(PasswordCheck.SuccessRehashNeeded, _passwords.Verify(legacy, "password1"));
        Assert.Equal(PasswordCheck.Failed, _passwords.Verify(legacy, "password2"));
    }

    [Theory]
    [InlineData("!")]
    [InlineData("")]
    [InlineData("nopass")]
    public void UnusableHashesNeverVerify(string stored) =>
        Assert.Equal(PasswordCheck.Failed, _passwords.Verify(stored, "nopass"));

    [Theory]
    [InlineData(null, false)]
    [InlineData("short", false)]
    [InlineData("long enough", true)]
    public void PolicyRequiresEightCharacters(string? password, bool valid) =>
        Assert.Equal(valid, PasswordService.ValidatePolicy(password) is null);
}
