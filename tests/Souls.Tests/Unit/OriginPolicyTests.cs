using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Configuration;
using Souls.Server.Network;

namespace Souls.Tests.Unit;

public class OriginPolicyTests
{
    private static HttpContext Request(string scheme, string host, string? origin)
    {
        var context = new DefaultHttpContext();
        context.Request.Scheme = scheme;
        context.Request.Host = new HostString(host);
        if (origin is not null)
        {
            context.Request.Headers.Origin = origin;
        }

        return context;
    }

    private static OriginPolicy Policy(string allowed = "") =>
        new(new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?> { ["Souls:AllowedOrigins"] = allowed }).Build());

    [Theory]
    [InlineData("https", "souls.example.com", "https://souls.example.com", true)]
    [InlineData("wss", "souls.example.com", "https://souls.example.com", true)]
    [InlineData("ws", "localhost:8088", "http://localhost:8088", true)]
    [InlineData("https", "souls.example.com", "https://evil.example", false)]
    [InlineData("https", "souls.example.com", "http://souls.example.com", false)]
    [InlineData("https", "souls.example.com", "https://souls.example.com:8443", false)]
    [InlineData("https", "souls.example.com", null, true)]
    public void DefaultsToSameOrigin(string scheme, string host, string? origin, bool allowed) =>
        Assert.Equal(allowed, Policy().IsAllowed(Request(scheme, host, origin)));

    [Fact]
    public void ConfiguredOriginsReplaceTheSameOriginRule()
    {
        var policy = Policy("https://play.example.com, https://www.example.com/");

        Assert.True(policy.IsAllowed(Request("https", "api.example.com", "https://play.example.com")));
        Assert.True(policy.IsAllowed(Request("https", "api.example.com", "https://www.example.com")));
        Assert.False(policy.IsAllowed(Request("https", "api.example.com", "https://api.example.com")));
    }
}
