using System.Text.RegularExpressions;
using System.Xml.Linq;
using Souls.Model;
using Souls.Model.Entities;
using Souls.Model.Localization;
using Souls.Model.Security;
using Races = Souls.Model.GameRules.Races;

namespace Souls.Tests.Unit;

/// <summary>
/// The string tables (Souls.Model/Localization/*.json, the site's Resources/SharedResource.*.resx) are complete and
/// used, and the game server sends a key next to every text a player sees.
/// </summary>
public partial class LocalizationTests
{
    private static readonly string[] OtherLanguages = [.. Strings.Languages.Where(l => l != Strings.Default)];

    private static string Base(string key) => PluralSuffix().Replace(key, "");

    [Fact]
    public void NorwegianIsAvailable() => Assert.Contains("nb", Strings.Languages);

    [Fact]
    public void EveryEnglishKeyIsTranslated()
    {
        foreach (var language in OtherLanguages)
        {
            var missing = Strings.Own(Strings.Default).Keys.Where(k => !Strings.Own(language).ContainsKey(k)).Order().ToList();
            Assert.True(missing.Count == 0, $"Missing in {language}: {string.Join(", ", missing)}");
        }
    }

    [Fact]
    public void TranslationsHaveNoKeysEnglishLacks()
    {
        foreach (var language in OtherLanguages)
        {
            // Flavor texts: English comes from the database (see Card.ToJson).
            var extra = Strings.Own(language).Keys
                .Where(k => !Strings.Own(Strings.Default).ContainsKey(k) && !Strings.Own(Strings.Default).ContainsKey(Base(k) + "_other") && !k.StartsWith("flavor.", StringComparison.Ordinal))
                .Order().ToList();
            Assert.True(extra.Count == 0, $"Only in {language}: {string.Join(", ", extra)}");
        }
    }

    [Fact]
    public void TranslationsKeepThePlaceholders()
    {
        var english = Strings.Own(Strings.Default);
        foreach (var language in OtherLanguages)
        {
            foreach (var (key, text) in Strings.Own(language).Where(e => english.ContainsKey(e.Key)))
            {
                var expected = Placeholders(english[key]);
                var actual = Placeholders(text);
                // A singular may say "a card" instead of "{n} cards".
                Assert.True(key.EndsWith("_one", StringComparison.Ordinal) ? actual.IsSubsetOf(expected.Append("n")) : actual.SetEquals(expected),
                    $"{language} {key}: {{{string.Join(",", actual)}}} vs English {{{string.Join(",", expected)}}}");
            }
        }

        static HashSet<string> Placeholders(string text) => [.. Placeholder().Matches(text).Select(m => m.Groups[1].Value)];
    }

    [Fact]
    public void EverySeededCardFlavorIsTranslated()
    {
        var flavored = SeedData.Cards.Where(c => c.Flavor is not null).Select(c => $"flavor.{c.Id}").Append($"flavor.{GameRules.LostSoulId}").ToHashSet();
        foreach (var language in OtherLanguages)
        {
            var own = Strings.Own(language).Keys.Where(k => k.StartsWith("flavor.", StringComparison.Ordinal)).ToHashSet();
            Assert.Equal(flavored.Order(), own.Order());
        }
    }

    /// <summary>Every rules text, rank, quest and emote has its text in every language, with all placeholders filled.</summary>
    [Fact]
    public void GameTextsRenderInEveryLanguage()
    {
        var texts = new List<GameText>();
        foreach (var id in GameRules.Abilities.Keys)
        {
            texts.AddRange([GameRules.AbilityName(id), GameRules.AbilityRules(id, 1), GameRules.AbilityRules(id, 2, Races.Lightbringer), GameRules.AbilityLabelText(id, 1), GameRules.AbilityLabelText(id, 3)]);
        }

        texts.AddRange(GameRules.RaceTexts.Values.SelectMany(r => new[] { r.Name, r.Text }));
        texts.AddRange(GameRules.HeroPowers.Values.SelectMany(p => new[] { p.Name, p.Text }));
        texts.AddRange(GameRules.Emotes);
        texts.AddRange([GameRules.Keywords.Ward, GameRules.Keywords.SummoningSick, GameRules.Keywords.Paralyzed, GameRules.Keywords.Armor, GameRules.Keywords.Fatigue, GameRules.Keywords.Burned, GameRules.Keywords.Spell]);
        texts.AddRange(Quests.All.Select(q => q.Text));
        texts.AddRange(Enumerable.Range(1, 17).Select(rank => Ratings.TierOf(rank).Text));
        texts.AddRange(new[] { Rarity.Common, Rarity.Rare, Rarity.Epic, Rarity.Legendary }.Select(Rarity.Text));
        texts.Add(Seasons.NameText(new Season { Number = 3, Name = Seasons.DefaultName(3) })!);
        foreach (var rarity in new[] { Rarity.Common, Rarity.Rare, Rarity.Epic, Rarity.Legendary })
        {
            texts.Add(Decks.Validate([(1, 9)], new Dictionary<int, int> { [1] = rarity })!);
        }

        texts.AddRange([Decks.Validate([(1, 1)], new Dictionary<int, int>())!, Decks.Validate([(1, 1)], new Dictionary<int, int> { [1] = Rarity.Common })!]);
        texts.AddRange(new[] { "", "short", new string('x', 200) }.Select(PasswordService.ValidatePolicy).OfType<GameText>());

        foreach (var language in Strings.Languages)
        {
            foreach (var text in texts)
            {
                AssertTranslated(language, text);
                var shown = text.In(language);
                Assert.False(shown.Contains('{', StringComparison.Ordinal), $"{language} {text.Key}: {shown}");
            }
        }

        static void AssertTranslated(string language, GameText text)
        {
            Assert.True(Strings.Has(language, text.Key) || Strings.Has(language, text.Key + "_other"), $"{text.Key} has no {language} text");
            foreach (var inner in text.Args?.Values.OfType<GameText>() ?? [])
            {
                AssertTranslated(language, inner);
            }
        }
    }

    [Fact]
    public void EnglishGameTextsAreUnchanged()
    {
        Assert.Equal("Burn 3", GameRules.AbilityLabel(Ability.Burn, 3));
        Assert.Equal("Rally +1", GameRules.AbilityLabel(Ability.Rally, 1));
        Assert.Equal("When played, draw 1 card.", GameRules.AbilityText(Ability.Insight, 1));
        Assert.Equal("When played, summons 2 1/1 Lost Souls next to it.", GameRules.AbilityText(Ability.Summon, 2));
        Assert.Equal("Bronze III", Ratings.TierOf(1).ToString());
        Assert.Equal("Win 2 normal games", Quests.All[0].Text.ToString());
        Assert.Equal("Gjør 3 skade på et fiendtlig kort eller fiendens helt.", GameRules.AbilityRules(Ability.Burn, 3).In("nb"));
        Assert.Equal("Sølv I", Ratings.TierOf(6).Text.In("nb"));
        Assert.Equal("ann bruker Hellig lys på Pesta.", new GameText("log.heroPower", ("player", "ann"), ("power", GameRules.HeroPowers[3].Name), ("target", "Pesta")).In("nb"));
        Assert.Equal("Pesta påkaller 2 Lost Souls.", new GameText("log.summon", ("card", "Pesta"), ("n", 2)).In("nb"));
    }

    [Fact]
    public void StoredArgumentsReadBack()
    {
        var text = new GameText("log.heroPower", ("player", "ann"), ("power", GameRules.HeroPowers[3].Name), ("target", "Pesta"));
        var back = GameText.FromJson(text.Key, text.ArgsJson()!.ToJsonString());
        Assert.Equal(text.ToString(), back.ToString());
        Assert.Equal(text.In("nb"), back.In("nb"));
    }

    // ---- Sources ---------------------------------------------------------------------------------------------------

    private static readonly Lazy<string> RepoRoot = new(() =>
    {
        for (var dir = new DirectoryInfo(AppContext.BaseDirectory); dir is not null; dir = dir.Parent)
        {
            if (File.Exists(Path.Combine(dir.FullName, "Souls.slnx")))
            {
                return dir.FullName;
            }
        }

        throw new InvalidOperationException("Souls.slnx not found above " + AppContext.BaseDirectory);
    });

    private static IEnumerable<string> SourceFiles(string folder, params string[] patterns) =>
        patterns.SelectMany(p => Directory.EnumerateFiles(Path.Combine(RepoRoot.Value, folder), p, SearchOption.AllDirectories))
            .Where(f => !f.Contains($"{Path.DirectorySeparatorChar}bin{Path.DirectorySeparatorChar}", StringComparison.Ordinal)
                && !f.Contains($"{Path.DirectorySeparatorChar}obj{Path.DirectorySeparatorChar}", StringComparison.Ordinal)
                && !f.Contains($"{Path.DirectorySeparatorChar}Vendor{Path.DirectorySeparatorChar}", StringComparison.Ordinal)
                && !f.Contains($"wwwroot{Path.DirectorySeparatorChar}lib{Path.DirectorySeparatorChar}", StringComparison.Ordinal)
                && !f.Contains($"{Path.DirectorySeparatorChar}Migrations{Path.DirectorySeparatorChar}", StringComparison.Ordinal));

    /// <summary>Keys built at run time from ids or names (the tests above check their families are complete).</summary>
    private static readonly Regex[] DynamicKeys =
    [
        new(@"^(ability|race|power)\.\d+\.(name|text)$"), new(@"^emote\.\d+$"), new(@"^flavor\.\d+$"), new(@"^quest\."), new(@"^tier\."),
        new(@"^rarity\."), new(@"^deck\.maxCopies\."), new(@"^close\."),
    ];

    /// <summary>Every key of the game tables is used somewhere by its literal name (or belongs to a family built from ids).</summary>
    [Fact]
    public void EveryGameKeyIsUsed()
    {
        var sources = string.Join("\n", SourceFiles("src", "*.cs", "*.cshtml", "*.js").Select(File.ReadAllText));
        var unused = Strings.Own(Strings.Default).Keys.Select(Base).Distinct()
            .Where(k => !DynamicKeys.Any(d => d.IsMatch(k)) && !new[] { '"', '\'', '`' }.Any(q => sources.Contains(q + k + q, StringComparison.Ordinal)))
            .Order().ToList();
        Assert.True(unused.Count == 0, "Unused keys: " + string.Join(", ", unused));
    }

    /// <summary>Every literal key the server, the model, the site and the clients use exists in English.</summary>
    [Fact]
    public void EveryUsedGameKeyExists()
    {
        var prefixes = Strings.Own(Strings.Default).Keys.Select(k => k[..(k.IndexOf('.') + 1)]).Where(p => p.Length > 1).ToHashSet();
        var missing = new SortedSet<string>();
        foreach (var file in SourceFiles("src", "*.cs", "*.cshtml", "*.js"))
        {
            foreach (Match m in QuotedKey().Matches(File.ReadAllText(file)))
            {
                var key = m.Groups[2].Value;
                if (prefixes.Contains(key[..(key.IndexOf('.') + 1)]) && !key.EndsWith('.') && !FileName().IsMatch(key) && !Strings.Has(Strings.Default, key) && !Strings.Has(Strings.Default, key + "_other")
                    && !DynamicKeys.Any(d => d.IsMatch(key)))
                {
                    missing.Add($"{key} ({Path.GetFileName(file)})");
                }
            }
        }

        Assert.True(missing.Count == 0, "Keys without an English text: " + string.Join(", ", missing));
    }

    /// <summary>The server only sends texts through <see cref="GameText"/> (no string literal as a message payload).</summary>
    [Fact]
    public void ServerSendsNoLiteralTexts()
    {
        var literal = new Regex(@"new Response\([^;]*?,\s*\$?""");
        var found = SourceFiles(Path.Combine("src", "Souls.Server"), "*.cs")
            .SelectMany(f => File.ReadAllLines(f).Select(l => (File: Path.GetFileName(f), Line: l.Trim())))
            // The bot and the admin socket get protocol strings, not texts for players.
            .Where(x => literal.IsMatch(x.Line) && !x.Line.Contains("GameBotDisconnect", StringComparison.Ordinal) && !x.Line.Contains("AdminRequest.", StringComparison.Ordinal))
            .Select(x => $"{x.File}: {x.Line}").ToList();
        Assert.True(found.Count == 0, string.Join("\n", found));
    }

    /// <summary>
    /// The site's texts: every literal key of <c>L["..."]</c>, <c>localizer["..."]</c> and <c>ErrorMessage = "..."</c>
    /// has a text in every SharedResource.{language}.resx with the same placeholders, and every resource is used.
    /// </summary>
    [Fact]
    public void SiteResourcesMatchTheSources()
    {
        var used = new HashSet<string>(StringComparer.Ordinal);
        foreach (var file in SourceFiles(Path.Combine("src", "Souls.Web"), "*.cs", "*.cshtml"))
        {
            var source = File.ReadAllText(file);
            foreach (Match m in SiteKey().Matches(source))
            {
                used.Add(m.Groups["k"].Value.Replace("\\\"", "\"", StringComparison.Ordinal).Replace("\\\\", "\\", StringComparison.Ordinal));
            }
        }

        used.Remove("..."); // the example in SharedResource.cs

        // Every site language but English (the keys) has its resx, one per table language.
        var files = Directory.GetFiles(Path.Combine(RepoRoot.Value, "src", "Souls.Web", "Resources"), "SharedResource.*.resx");
        Assert.Equal(OtherLanguages.Order(), files.Select(f => Path.GetFileName(f).Split('.')[1]).Order());
        foreach (var file in files)
        {
            var name = Path.GetFileName(file);
            var entries = XDocument.Load(file).Root!.Elements("data").ToDictionary(d => (string)d.Attribute("name")!, d => (string)d.Element("value")!, StringComparer.Ordinal);

            var missing = used.Where(k => !entries.ContainsKey(k)).Order().ToList();
            Assert.True(missing.Count == 0, $"Not in {name}: " + string.Join(" | ", missing));
            var unused = entries.Keys.Where(k => !used.Contains(k)).Order().ToList();
            Assert.True(unused.Count == 0, $"Unused in {name}: " + string.Join(" | ", unused));

            // Resource names are case-insensitive: two keys differing only in case would collide.
            var clashes = entries.Keys.GroupBy(k => k, StringComparer.OrdinalIgnoreCase).Where(g => g.Count() > 1).Select(g => g.Key).ToList();
            Assert.True(clashes.Count == 0, "Keys differing only in case: " + string.Join(" | ", clashes));

            foreach (var (key, value) in entries)
            {
                Assert.False(string.IsNullOrWhiteSpace(value), $"{name}: empty translation for '{key}'");
                Assert.Equal(FormatItems().Matches(key).Select(m => m.Value).Distinct().Order(), FormatItems().Matches(value).Select(m => m.Value).Distinct().Order());
            }
        }
    }

    [GeneratedRegex("_(one|other)$")]
    private static partial Regex PluralSuffix();

    [GeneratedRegex(@"\{(\w+)\}")]
    private static partial Regex Placeholder();

    [GeneratedRegex(@"\{\d+(:[^}]*)?\}")]
    private static partial Regex FormatItems();

    [GeneratedRegex(@"\.(jpg|png|gif|webp|svg|js|css|json|mp3|ogg|wav)$")]
    private static partial Regex FileName();

    [GeneratedRegex(@"([""'`])([a-z0-9]+\.[A-Za-z0-9_.]+)\1")]
    private static partial Regex QuotedKey();

    /// <summary>A literal site key: <c>L["..."]</c>, <c>localizer["..."]</c> or <c>ErrorMessage = "..."</c> (group <c>k</c>).</summary>
    [GeneratedRegex(@"(?:\bL|\blocalizer)\[""(?<k>(?:[^""\\]|\\.)*)""|ErrorMessage\s*=\s*""(?<k>(?:[^""\\]|\\.)*)""")]
    private static partial Regex SiteKey();
}
