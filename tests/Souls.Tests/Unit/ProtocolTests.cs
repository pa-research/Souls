using System.Text.Json.Nodes;
using Souls.Server.Network;

namespace Souls.Tests.Unit;

public class ProtocolTests
{
    [Fact]
    public void ParsesNumbersAndNumericStrings()
    {
        var message = Message.Parse("""{"Type":"1002","Payload":{"room":"3","message":"hi","x":12.5}}""");

        Assert.Equal(1002, message.Type);
        Assert.Equal(3, message.GetInt("room"));
        Assert.Equal("hi", message.GetString("message", 10));
        Assert.Equal(12.5, message.GetDouble("x"));
    }

    [Theory]
    [InlineData("not json")]
    [InlineData("[1,2,3]")]
    [InlineData("""{"Payload":{}}""")]
    [InlineData("""{"Type":"abc"}""")]
    public void RejectsMalformedMessages(string json) =>
        Assert.Throws<ProtocolException>(() => Message.Parse(json));

    [Fact]
    public void RejectsMissingOrInvalidFields()
    {
        var message = Message.Parse("""{"Type":200,"Payload":{"source":1.5,"name":"x"}}""");

        Assert.Throws<ProtocolException>(() => message.GetInt("source"));
        Assert.Throws<ProtocolException>(() => message.GetInt("target"));
        Assert.Throws<ProtocolException>(() => message.GetString("name", 0));
    }

    [Fact]
    public void RejectsDeeplyNestedPayloads()
    {
        var json = """{"Type":1,"Payload":""" + new string('[', 50) + new string(']', 50) + "}";
        Assert.Throws<ProtocolException>(() => Message.Parse(json));
    }

    [Fact]
    public void ResponsesUseTheOriginalEnvelope()
    {
        var payload = new JsonObject { ["cid"] = 7 };
        var json = JsonNode.Parse(new Response(GameResponse.GameRelease, payload).ToJson())!;

        Assert.Equal(212, (int)json["Type"]!);
        Assert.Equal(7, (int)json["Payload"]!["cid"]!);

        // The payload can be reused for a second response.
        Assert.Contains("210", new Response(GameResponse.GameOpponentRelease, payload).ToJson(), StringComparison.Ordinal);
    }
}
