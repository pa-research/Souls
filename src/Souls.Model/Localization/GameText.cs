using System.Globalization;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace Souls.Model.Localization;

/// <summary>
/// A text the game shows: a key into the string tables (<see cref="Strings"/>) and its arguments. An argument is a
/// string or number shown as it is (player and card names), or another <see cref="GameText"/> shown in the reader's
/// language (a hero power's name). <see cref="ToString"/> is the English text.
/// </summary>
public sealed record GameText(string Key, IReadOnlyDictionary<string, object>? Args = null)
{
    public GameText(string key, params (string Name, object Value)[] args)
        : this(key, args.Length == 0 ? null : args.ToDictionary(a => a.Name, a => a.Value))
    {
    }

    /// <summary>The text in <paramref name="language"/> ("en", "nb"; others fall back to English).</summary>
    public string In(string language) => Strings.Format(language, this);

    public override string ToString() => In(Strings.Default);

    /// <summary>The arguments as sent to the clients: <c>{"name": "ann", "power": {"key": "power.3.name"}}</c>.</summary>
    public JsonObject? ArgsJson()
    {
        if (Args is null)
        {
            return null;
        }

        var json = new JsonObject();
        foreach (var (name, value) in Args)
        {
            json[name] = value switch
            {
                GameText text => text.ToJson(),
                int i => i,
                long l => l,
                _ => Convert.ToString(value, CultureInfo.InvariantCulture),
            };
        }

        return json;
    }

    /// <summary><c>{"key", "args"}</c>, the form of a nested argument.</summary>
    public JsonObject ToJson()
    {
        var json = new JsonObject { ["key"] = Key };
        if (ArgsJson() is { } args)
        {
            json["args"] = args;
        }

        return json;
    }

    /// <summary>
    /// Sets <paramref name="field"/> of <paramref name="target"/> to the English text and adds the key and arguments
    /// next to it (<c>textKey</c>, <c>textArgs</c>), so clients can show it in their own language.
    /// </summary>
    public void WriteTo(JsonObject target, string field)
    {
        target[field] = ToString();
        target[field + "Key"] = Key;
        if (ArgsJson() is { } args)
        {
            target[field + "Args"] = args;
        }
    }

    /// <summary>Reads what <see cref="ArgsJson"/> wrote (stored game logs).</summary>
    public static GameText FromJson(string key, string? args)
    {
        if (string.IsNullOrEmpty(args) || JsonNode.Parse(args) is not JsonObject json)
        {
            return new GameText(key);
        }

        return new GameText(key, json.ToDictionary(p => p.Key, p => Read(p.Value)));

        static object Read(JsonNode? node) => node switch
        {
            JsonObject o when o["key"]?.GetValue<string>() is { } key => FromJson(key, o["args"]?.ToJsonString()),
            JsonValue v when v.GetValueKind() == JsonValueKind.Number => v.GetValue<int>(),
            _ => node?.ToString() ?? string.Empty,
        };
    }
}

/// <summary>
/// The game's string tables, one per language: the embedded <c>Localization/*.{language}.json</c> files (flat
/// <c>{"key": "template"}</c> objects) merged. Templates use named placeholders (<c>{player} plays {card}.</c>);
/// a key with <c>_one</c> and <c>_other</c> variants is picked by its <c>n</c> argument. The web site sends the
/// table of the page's language to the game clients, which format the same templates (<c>/js/l10n.js</c>).
/// </summary>
public static partial class Strings
{
    public const string Default = "en";

    private static readonly Dictionary<string, Dictionary<string, string>> Tables = Load();

    // Each language's own keys over English.
    private static readonly Dictionary<string, Dictionary<string, string>> Merged = Tables.ToDictionary(
        t => t.Key, t => new Dictionary<string, string>(Tables[Default].Concat(t.Value).GroupBy(e => e.Key).Select(g => g.Last())));

    /// <summary>The languages with a table, English first.</summary>
    public static IReadOnlyList<string> Languages { get; } = [Default, .. Tables.Keys.Where(l => l != Default).Order()];

    /// <summary>The table of one language with English for the keys it does not have.</summary>
    public static IReadOnlyDictionary<string, string> Table(string language) => Merged.TryGetValue(language, out var t) ? t : Merged[Default];

    /// <summary>Only the keys a language defines itself (for the completeness tests).</summary>
    public static IReadOnlyDictionary<string, string> Own(string language) => Tables.TryGetValue(language, out var t) ? t : [];

    /// <summary>The language of a culture if there is a table for it, else English.</summary>
    public static string LanguageOf(CultureInfo culture) =>
        Tables.ContainsKey(culture.TwoLetterISOLanguageName) ? culture.TwoLetterISOLanguageName : Default;

    /// <summary>The text of a key in a language (English if the language does not have it; the key if nobody has it).</summary>
    public static string Get(string language, string key) =>
        (Tables.TryGetValue(language, out var own) && own.TryGetValue(key, out var value)) || Tables[Default].TryGetValue(key, out value)
            ? value
            : key;

    public static bool Has(string language, string key) => Tables.TryGetValue(language, out var own) && own.ContainsKey(key);

    public static string Format(string language, GameText text)
    {
        var key = text.Key;
        if (text.Args?.GetValueOrDefault("n") is int n && (Has(language, key + "_one") || Has(Default, key + "_one")))
        {
            // ponytail: one/other covers English and Norwegian; a language with more plural forms needs CLDR rules here
            // (the browser side already uses Intl.PluralRules).
            key += n == 1 ? "_one" : "_other";
        }

        return Placeholder().Replace(Get(language, key), m => text.Args?.GetValueOrDefault(m.Groups[1].Value) switch
        {
            null => m.Value,
            GameText inner => inner.In(language),
            var value => Convert.ToString(value, CultureInfo.InvariantCulture) ?? string.Empty,
        });
    }

    private static readonly string[] Difficulties = ["Easy", "Normal", "Hard"];

    /// <summary>
    /// The name of a practice bot: "[BOT] Satan (Hard)". The difficulty stays English in the name (it is stored with the
    /// games); <see cref="PlayerName"/> and the clients (<c>SoulsL10n.localizeMessage</c>) show it in the reader's language.
    /// </summary>
    public static string BotName(string name, int difficulty) => $"[BOT] {name} ({Difficulties[Math.Clamp(difficulty, 0, 2)]})";

    /// <summary>A player's name in a language: a bot's difficulty translated ("[BOT] Satan (Vanskelig)"), anyone else's as it is.</summary>
    public static string PlayerName(string name, string language) =>
        BotNamePattern().Match(name) is { Success: true } bot
            ? $"{bot.Groups[1].Value} ({Get(language, "difficulty." + bot.Groups[2].Value.ToLowerInvariant())})"
            : name;

    [GeneratedRegex(@"^(\[BOT\] .+) \((Easy|Normal|Hard)\)$")]
    private static partial Regex BotNamePattern();

    [GeneratedRegex(@"\{(\w+)\}")]
    private static partial Regex Placeholder();

    private static Dictionary<string, Dictionary<string, string>> Load()
    {
        var assembly = typeof(Strings).Assembly;
        var prefix = typeof(Strings).Namespace + ".";
        var tables = new Dictionary<string, Dictionary<string, string>>();
        foreach (var name in assembly.GetManifestResourceNames().Where(n => n.StartsWith(prefix, StringComparison.Ordinal) && n.EndsWith(".json", StringComparison.Ordinal)))
        {
            // Souls.Model.Localization.game.nb.json -> nb
            var parts = name[prefix.Length..].Split('.');
            var language = parts[^2];
            using var stream = assembly.GetManifestResourceStream(name)!;
            var entries = JsonSerializer.Deserialize<Dictionary<string, string>>(stream)!;
            var table = tables.TryGetValue(language, out var t) ? t : tables[language] = [];
            foreach (var (key, value) in entries)
            {
                if (!table.TryAdd(key, value))
                {
                    throw new InvalidOperationException($"The key '{key}' is defined twice for '{language}' ({name}).");
                }
            }
        }

        return tables;
    }
}
