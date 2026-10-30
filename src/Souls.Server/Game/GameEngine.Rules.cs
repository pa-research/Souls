using System.Text.Json.Nodes;
using Souls.Model;
using Souls.Server.Network;
using Souls.Server.Objects;
using Ability = Souls.Model.Entities.Ability;
using GameLogKind = Souls.Model.Entities.GameLogKind;
using Races = Souls.Model.GameRules.Races;

namespace Souls.Server.Game;

/// <summary>
/// How actions resolve. Every change is reported as an event (see <see cref="GameRoom.Event"/>); targets are
/// referred to as <c>{"k": "card", "cid": n}</c> or <c>{"k": "hero", "id": ident}</c>.
/// </summary>
public sealed partial class GameEngine
{
    private static JsonObject Ref(object target) => target switch
    {
        Card c => new JsonObject { ["k"] = "card", ["cid"] = c.Cid },
        GamePlayer h => new JsonObject { ["k"] = "hero", ["id"] = h.Ident },
        _ => throw new ArgumentException("Unknown target", nameof(target)),
    };

    private static string NameOf(object target) => target switch
    {
        Card c => c.Name,
        GamePlayer h => h.Name,
        _ => "?",
    };

    /// <summary>An attack: both sides deal their attack to each other (Ferocious attackers hit 1 harder).</summary>
    private void Fight(GameRoom room, GamePlayer attackerSide, object attacker, GamePlayer defenderSide, object defender)
    {
        room.Event("attack", new JsonObject { ["src"] = Ref(attacker), ["dst"] = Ref(defender) });
        var attackerCard = attacker as Card;
        var defenderCard = defender as Card;
        var hit = attacker switch
        {
            Card c => c.Attack + (c.RaceId == Races.Ferocious ? 1 : 0),
            GamePlayer h => h.Attack,
            _ => 0,
        };
        var counter = defender switch
        {
            Card c => c.Attack,
            GamePlayer h => h.Attack,
            _ => 0,
        };

        if (attackerCard is not null)
        {
            // Fury cards may attack a second time.
            attackerCard.AttacksThisTurn++;
            attackerCard.HasAttacked = !(attackerCard.HasFury && attackerCard.AttacksThisTurn < 2);
        }
        else
        {
            attackerSide.HasAttacked = true;
        }

        Damage(room, defender, hit, attackerSide, attackerCard);
        Damage(room, attacker, counter, defenderSide, defenderCard);
        ResolveDeaths(room);
    }

    /// <summary>
    /// Deals damage: a ward blocks it completely, then armor absorbs it before health. Venom sources destroy the cards
    /// they damage; Vampiric sources heal their hero by the damage dealt.
    /// </summary>
    private void Damage(GameRoom room, object target, int amount, GamePlayer? sourceSide, Card? sourceCard)
    {
        if (amount <= 0)
        {
            return;
        }

        int absorbed;
        switch (target)
        {
            case Card { Ward: true } warded:
                warded.Ward = false;
                room.Event("ward", new JsonObject { ["to"] = Ref(warded), ["on"] = false });
                room.LogLine($"{warded.Name}'s ward breaks.");
                return;
            case Card c:
                absorbed = Math.Min(c.Armor, amount);
                c.Armor -= absorbed;
                c.Health -= amount - absorbed;
                room.Event("damage", new JsonObject { ["to"] = Ref(c), ["amount"] = amount, ["armorLost"] = absorbed, ["health"] = c.Health, ["armor"] = c.Armor });
                if (sourceCard is { HasVenom: true } && c.Health > 0)
                {
                    c.Health = 0;
                    room.Event("venom", new JsonObject { ["src"] = Ref(sourceCard), ["to"] = Ref(c) });
                    room.LogLine($"{sourceCard.Name}'s venom kills {c.Name}.");
                }

                break;
            case GamePlayer h:
                absorbed = Math.Min(h.Armor, amount);
                h.Armor -= absorbed;
                h.Health -= amount - absorbed;
                if (sourceSide is not null && sourceSide != h)
                {
                    sourceSide.HeroDamage += amount;
                }

                room.Event("damage", new JsonObject { ["to"] = Ref(h), ["amount"] = amount, ["armorLost"] = absorbed, ["health"] = h.Health, ["armor"] = h.Armor });
                break;
        }

        if (sourceCard is { RaceId: Races.Vampiric, IsToken: false } && sourceSide is not null)
        {
            var healed = Heal(room, sourceSide, amount, emit: false);
            if (healed > 0)
            {
                room.Event("lifesteal", new JsonObject { ["src"] = Ref(sourceCard), ["to"] = Ref(sourceSide), ["amount"] = healed, ["health"] = sourceSide.Health });
                room.LogLine($"{sourceCard.Name} drains {healed} health for {sourceSide.Name}.");
            }
        }
    }

    /// <summary>Restores health up to the maximum. Returns the health restored.</summary>
    private static int Heal(GameRoom room, object target, int amount, bool emit = true)
    {
        int healed;
        switch (target)
        {
            case Card c:
                healed = Math.Clamp(c.MaxHealth - c.Health, 0, amount);
                c.Health += healed;
                if (emit)
                {
                    room.Event("heal", new JsonObject { ["to"] = Ref(c), ["amount"] = healed, ["health"] = c.Health });
                }

                return healed;
            case GamePlayer h:
                healed = Math.Clamp(h.MaxHealth - h.Health, 0, amount);
                h.Health += healed;
                if (emit)
                {
                    room.Event("heal", new JsonObject { ["to"] = Ref(h), ["amount"] = healed, ["health"] = h.Health });
                }

                return healed;
            default:
                return 0;
        }
    }

    private static void GainArmor(GameRoom room, object target, int amount)
    {
        int armor;
        switch (target)
        {
            case Card c:
                armor = c.Armor += amount;
                break;
            case GamePlayer h:
                armor = h.Armor += amount;
                break;
            default:
                return;
        }

        room.Event("armor", new JsonObject { ["to"] = Ref(target), ["amount"] = amount, ["armor"] = armor });
    }

    /// <summary>
    /// Removes dead cards until none are left: Haunt cards return to the hand once, Brood cards leave Lost Souls
    /// behind and Darkness cards curse a random enemy as they die. Dead heroes are handled by
    /// <see cref="FinishActionAsync"/>.
    /// </summary>
    private void ResolveDeaths(GameRoom room)
    {
        var current = room.CurrentPlaying.GPlayer!;
        GamePlayer[] sides = [current, room.Other(current)];
        for (var guard = 0; guard < 50; guard++)
        {
            var dead = sides.SelectMany(side => side.BoardCards.Values.Where(c => c.Health < 1 && !c.IsDead).OrderBy(c => c.SlotId).Select(c => (side, card: c))).ToList();
            if (dead.Count == 0)
            {
                return;
            }

            foreach (var (side, card) in dead)
            {
                card.IsDead = true;
                side.RemoveBoardCard(card);
                room.Other(side).CardsDestroyed++;
                room.Event("death", new JsonObject { ["cid"] = card.Cid, ["owner"] = side.Ident });
                room.LogLine($"{card.Name} dies.");
            }

            foreach (var (side, card) in dead.Where(d => d.card.AbilityId == Ability.Haunt && !d.card.Haunted && !d.card.IsToken))
            {
                ReturnToHand(room, side, card);
            }

            foreach (var (side, card) in dead.Where(d => d.card.AbilityId == Ability.Brood))
            {
                Trigger(room, card);
                SummonLostSouls(room, side, card, card.AbilityValue, card.SlotId);
            }

            foreach (var (side, card) in dead.Where(d => d.card.RaceId == Races.Darkness && !d.card.IsToken))
            {
                var enemy = room.Other(side);
                var targets = enemy.BoardCards.Values.Where(c => c.Health >= 1).Cast<object>().Append(enemy).ToList();
                var target = targets[room.Random.Next(targets.Count)];
                room.Event("curse", new JsonObject { ["src"] = card.Cid, ["owner"] = side.Ident, ["dst"] = Ref(target) });
                var text = $"{card.Name}'s death curse hits {NameOf(target)}.";
                room.Logger.Add(GameLogKind.DeathCurse, card.Id, target is Card tc ? tc.Id : room.PlayerOf(enemy.Ident).Id, "Card", target is Card ? "Card" : "Player", text);
                room.LogLine(text);
                Damage(room, target, GameRules.DeathCurseDamage, side, null);
            }
        }
    }

    /// <summary>Haunt: a fresh copy goes back to the hand (or burns if the hand is full).</summary>
    private void ReturnToHand(GameRoom room, GamePlayer side, Card card)
    {
        var copy = card.NewInstance();
        copy.Haunted = true;
        var owner = room.PlayerOf(side.Ident);
        var text = $"{card.Name} haunts the arena and returns to {side.Name}'s hand.";
        room.Logger.Add(GameLogKind.Haunt, card.Id, owner.Id, "Card", "Player", text);
        room.Event("haunt", new JsonObject { ["cid"] = card.Cid, ["newCid"] = copy.Cid, ["owner"] = side.Ident });
        room.LogLine(text);
        if (side.HandCards.Count >= GamePlayer.MaxHandCards)
        {
            Burn(room, side, copy);
            return;
        }

        side.HandCards[copy.Cid] = copy;
        room.FlushEvents();
        SendDrawn(owner, [copy], returned: true);
    }

    /// <summary>Draws cards: an empty deck deals growing fatigue damage, a full hand burns the card.</summary>
    private void Draw(GameRoom room, GamePlayer gp, int count)
    {
        var drawn = new List<Card>();
        for (var i = 0; i < count; i++)
        {
            if (gp.Deck.Count == 0)
            {
                gp.Fatigue++;
                var text = $"{gp.Name}'s deck is empty: {gp.Fatigue} fatigue damage.";
                var player = room.PlayerOf(gp.Ident);
                room.Logger.Add(GameLogKind.Fatigue, player.Id, player.Id, "Player", "Player", text);
                room.Event("fatigue", new JsonObject { ["id"] = gp.Ident, ["amount"] = gp.Fatigue });
                room.LogLine(text);
                Damage(room, gp, gp.Fatigue, null, null);
                continue;
            }

            var card = gp.Deck[^1];
            gp.Deck.RemoveAt(gp.Deck.Count - 1);
            if (gp.HandCards.Count >= GamePlayer.MaxHandCards)
            {
                Burn(room, gp, card);
                continue;
            }

            gp.HandCards[card.Cid] = card;
            drawn.Add(card);
            room.Logger.Add(GameLogKind.NewCard, room.PlayerOf(gp.Ident).Id, card.Id, "Player", "Card");
        }

        if (drawn.Count > 0)
        {
            room.FlushEvents();
            SendDrawn(room.PlayerOf(gp.Ident), drawn, returned: false);
        }
    }

    private static void SendDrawn(Player owner, List<Card> cards, bool returned)
    {
        owner.Send(new Response(GameResponse.GameNewCard, new JsonObject
        {
            ["card"] = new JsonArray([.. cards.Select(c => (JsonNode)c.ToJson())]),
            ["returned"] = returned,
        }));
        owner.GetOpponent()?.Send(new Response(GameResponse.GameOpponentNewCard, new JsonObject
        {
            ["card"] = new JsonArray([.. cards.Select(c => (JsonNode)new JsonObject { ["cid"] = c.Cid })]),
            ["returned"] = returned,
        }));
    }

    private static void Burn(GameRoom room, GamePlayer gp, Card card)
    {
        var text = $"{gp.Name}'s hand is full: {card.Name} burns.";
        room.Logger.Add(GameLogKind.CardBurned, room.PlayerOf(gp.Ident).Id, card.Id, "Player", "Card", text);
        room.Event("burned", new JsonObject { ["owner"] = gp.Ident, ["card"] = card.ToJson() });
        room.LogLine(text);
    }

    /// <summary>A card ability fires on its own (on play, at the start of the turn, on death): shown by the clients.</summary>
    private static void Trigger(GameRoom room, Card card)
    {
        room.Event("trigger", new JsonObject
        {
            ["abilityId"] = card.AbilityId,
            ["src"] = Ref(card),
            ["label"] = card.AbilityId is { } id ? GameRules.AbilityLabel(id, card.AbilityValueOverride) : null,
        });
    }

    /// <summary>
    /// Summons up to <paramref name="count"/> Lost Souls: the first in <paramref name="slot"/> if it is free, the rest
    /// as close to it as possible.
    /// </summary>
    private static void SummonLostSouls(GameRoom room, GamePlayer gp, Card source, int count, int slot)
    {
        var summoned = 0;
        for (var i = 0; i < count; i++)
        {
            int? free = gp.BoardCards.ContainsKey(slot) ? gp.FreeSlotNear(slot) : slot;
            if (free is not { } at)
            {
                break;
            }

            var token = Card.LostSoul();
            token.SlotId = at;
            token.HasAttacked = true;
            gp.BoardCards[at] = token;
            room.Event("summon", new JsonObject { ["src"] = source.Cid, ["owner"] = gp.Ident, ["card"] = token.ToJson() });
            summoned++;
        }

        if (summoned > 0)
        {
            var text = $"{source.Name} summons {(summoned == 1 ? "a Lost Soul" : $"{summoned} Lost Souls")}.";
            room.Logger.Add(GameLogKind.Summon, source.Id, source.Id, "Card", "Card", text);
            room.LogLine(text);
        }
    }

    /// <summary>What happens when a card enters the arena: Lightbringer blessing and the on-play abilities.</summary>
    private void OnPlay(GameRoom room, GamePlayer gp, Card card)
    {
        if (card.RaceId == Races.Lightbringer)
        {
            room.Event("blessing", new JsonObject { ["cid"] = card.Cid, ["to"] = Ref(gp) });
            var healed = Heal(room, gp, GameRules.LightbringerBlessing);
            if (healed > 0)
            {
                room.LogLine($"{card.Name} blesses {gp.Name} for {healed} health.");
            }
        }

        var value = card.AbilityValue;
        switch (card.AbilityId)
        {
            case Ability.Summon:
                if (gp.FreeSlotNear(card.SlotId) is not null)
                {
                    Trigger(room, card);
                    SummonLostSouls(room, gp, card, value, gp.FreeSlotNear(card.SlotId)!.Value);
                }

                break;

            case Ability.Rally:
            {
                var neighbours = new[] { card.SlotId - 1, card.SlotId + 1 }
                    .Select(slot => gp.BoardCards.GetValueOrDefault(slot)).OfType<Card>().ToList();
                if (neighbours.Count == 0)
                {
                    break;
                }

                Trigger(room, card);
                foreach (var n in neighbours)
                {
                    n.Attack += value;
                    room.Event("buff", new JsonObject { ["to"] = Ref(n), ["src"] = Ref(card), ["attack"] = n.Attack, ["health"] = n.Health, ["maxHealth"] = n.MaxHealth, ["armor"] = n.Armor });
                }

                LogTrigger(room, card, $"{card.Name} rallies {string.Join(" and ", neighbours.Select(n => n.Name))} (+{value} attack).");
                break;
            }

            case Ability.Insight:
                Trigger(room, card);
                LogTrigger(room, card, $"{card.Name} reveals {(value == 1 ? "a card" : $"{value} cards")}.");
                Draw(room, gp, value);
                break;

            case Ability.Inferno:
            {
                var enemy = room.Other(gp);
                var targets = enemy.BoardCards.Values.OrderBy(c => c.SlotId).ToList();
                Trigger(room, card);
                LogTrigger(room, card, $"{card.Name} sets the enemy line ablaze ({value} damage to every enemy card).");
                foreach (var target in targets)
                {
                    Damage(room, target, value, gp, card);
                }

                break;
            }
        }

        ResolveDeaths(room);
    }

    /// <summary>Start of a player's turn: Regenerate and Grow.</summary>
    private void StartOfTurn(GameRoom room, GamePlayer gp)
    {
        foreach (var card in gp.BoardCards.Values.OrderBy(c => c.SlotId).ToList())
        {
            switch (card.AbilityId)
            {
                case Ability.Regenerate when card.Health < card.MaxHealth:
                {
                    Trigger(room, card);
                    var healed = Heal(room, card, card.AbilityValue);
                    LogTrigger(room, card, $"{card.Name} regenerates {healed} health.");
                    break;
                }

                case Ability.Grow:
                {
                    var value = card.AbilityValue;
                    Trigger(room, card);
                    card.Attack += value;
                    card.Health += value;
                    card.MaxHealth += value;
                    room.Event("buff", new JsonObject { ["to"] = Ref(card), ["src"] = Ref(card), ["attack"] = card.Attack, ["health"] = card.Health, ["maxHealth"] = card.MaxHealth, ["armor"] = card.Armor });
                    LogTrigger(room, card, $"{card.Name} grows stronger (+{value}/+{value}).");
                    break;
                }
            }
        }
    }

    private static void LogTrigger(GameRoom room, Card card, string text)
    {
        room.Logger.Add(GameLogKind.AbilityTriggered, card.Id, card.Id, "Card", "Card", text);
        room.LogLine(text);
    }

    /// <summary>Resolves the ability of a board card. Returns <c>false</c> (and tells the player why) if it cannot be used.</summary>
    private bool UseAbility(GameRoom room, Player player, GamePlayer gp, Card card, TargetType type, int targetCid)
    {
        var enemy = room.Other(gp);
        object? target = type switch
        {
            TargetType.FriendlyCard => gp.FindBoardCard(targetCid),
            TargetType.OwnHero => gp,
            TargetType.EnemyHero => enemy,
            TargetType.EnemyCard => enemy.FindBoardCard(targetCid),
            _ => null,
        };

        var targetName = type switch
        {
            TargetType.FriendlyCard => "friendlyCard",
            TargetType.OwnHero => "ownHero",
            TargetType.EnemyHero => "enemyHero",
            _ => "enemyCard",
        };
        string? error = card.AbilityId switch
        {
            var id when !GameRules.IsActivated(id) => "This card has no ability to use!",
            _ when target is null => "Pick a valid target!",
            { } id when !GameRules.AbilityTargets(id).Contains(targetName) => id switch
            {
                Ability.Heal => "Cannot heal the enemy!",
                Ability.Harden => "Can only harden friendly targets!",
                Ability.Sacrifice => "Can only target friendly!",
                Ability.Paralyze => "Can only paralyze enemy cards!",
                Ability.Burn => "Can only burn enemies!",
                Ability.Drain => "Can only drain enemies!",
                _ => "Pick a valid target!",
            },
            Ability.Sacrifice when target == card => "Cannot cast on itself!",
            _ => null,
        };
        if (error is not null)
        {
            Tell(player, error);
            return false;
        }

        gp.AbilitiesUsed++;
        card.HasAttacked = true;
        room.Event("ability", new JsonObject { ["abilityId"] = card.AbilityId, ["src"] = Ref(card), ["dst"] = Ref(target!) });
        var targetDbId = target is Card tc ? tc.Id : room.PlayerOf(((GamePlayer)target!).Ident).Id;
        var targetType = target is Card ? "Card" : "Player";
        switch (card.AbilityId)
        {
            case Ability.Heal:
            {
                var amount = card.AbilityValue + (card.RaceId == Races.Lightbringer ? GameRules.LightbringerHealBonus : 0);
                var healed = Heal(room, target!, amount);
                var text = $"{card.Name} heals {NameOf(target!)} for {healed}.";
                if (target is Card healedCard)
                {
                    foreach (var slot in new[] { healedCard.SlotId - 1, healedCard.SlotId + 1 })
                    {
                        if (gp.BoardCards.TryGetValue(slot, out var neighbour))
                        {
                            Heal(room, neighbour, 1);
                        }
                    }
                }

                room.Logger.Add(GameLogKind.AbilityHeal, card.Id, targetDbId, "Card", targetType, text);
                room.LogLine(text);
                break;
            }

            case Ability.Sacrifice:
            {
                var text = $"{card.Name} sacrifices itself, strengthening {NameOf(target!)} (+{card.Attack} attack, +{Math.Max(0, card.Health)} health, +{card.Armor} armor).";
                switch (target)
                {
                    case Card t:
                        t.Attack += card.Attack;
                        t.Health += Math.Max(0, card.Health);
                        t.MaxHealth += Math.Max(0, card.Health);
                        t.Armor += card.Armor;
                        room.Event("buff", new JsonObject { ["to"] = Ref(t), ["attack"] = t.Attack, ["health"] = t.Health, ["maxHealth"] = t.MaxHealth, ["armor"] = t.Armor });
                        break;
                    case GamePlayer h:
                        h.Attack += card.Attack;
                        h.Health += Math.Max(0, card.Health);
                        h.MaxHealth += Math.Max(0, card.Health);
                        h.Armor += card.Armor;
                        room.Event("buff", new JsonObject { ["to"] = Ref(h), ["attack"] = h.Attack, ["health"] = h.Health, ["maxHealth"] = h.MaxHealth, ["armor"] = h.Armor });
                        break;
                }

                card.Health = 0;
                room.Logger.Add(GameLogKind.AbilitySacrifice, card.Id, targetDbId, "Card", targetType, text);
                room.LogLine(text);
                break;
            }

            case Ability.Paralyze:
            {
                var t = (Card)target!;
                t.Paralyzed = true;
                room.Event("paralyze", new JsonObject { ["cid"] = t.Cid, ["on"] = true });
                var text = $"{card.Name} paralyzes {t.Name}.";
                room.Logger.Add(GameLogKind.AbilityParalyze, card.Id, targetDbId, "Card", targetType, text);
                room.LogLine(text);
                break;
            }

            case Ability.Harden:
            {
                GainArmor(room, target!, card.AbilityValue);
                var text = $"{card.Name} hardens {NameOf(target!)} (+{card.AbilityValue} armor).";
                room.Logger.Add(GameLogKind.AbilityHarden, card.Id, targetDbId, "Card", targetType, text);
                room.LogLine(text);
                break;
            }

            case Ability.Burn:
            {
                var text = $"{card.Name} burns {NameOf(target!)} for {card.AbilityValue}.";
                room.Logger.Add(GameLogKind.AbilityBurn, card.Id, targetDbId, "Card", targetType, text);
                room.LogLine(text);
                Damage(room, target!, card.AbilityValue, gp, card);
                break;
            }

            case Ability.Drain:
            {
                var text = $"{card.Name} drains {NameOf(target!)} for {card.AbilityValue}.";
                room.Logger.Add(GameLogKind.AbilityDrain, card.Id, targetDbId, "Card", targetType, text);
                room.LogLine(text);
                Damage(room, target!, card.AbilityValue, gp, card);
                var healed = Heal(room, gp, card.AbilityValue, emit: false);
                if (healed > 0)
                {
                    room.Event("lifesteal", new JsonObject { ["src"] = Ref(target!), ["to"] = Ref(gp), ["amount"] = healed, ["health"] = gp.Health });
                }

                break;
            }
        }

        ResolveDeaths(room);
        return true;
    }

    /// <summary>The hero power of the player's class. Returns <c>false</c> (and tells the player why) if it cannot be used.</summary>
    private bool UseHeroPower(GameRoom room, Player player, GamePlayer gp, TargetType type, int targetCid)
    {
        if (!GameRules.HeroPowers.TryGetValue(gp.Type, out var power))
        {
            Tell(player, "Your hero has no power!");
            return false;
        }

        var enemy = room.Other(gp);
        object? target = power.Target switch
        {
            "none" => gp,
            "enemy" => type switch
            {
                TargetType.EnemyHero => enemy,
                TargetType.EnemyCard => enemy.FindBoardCard(targetCid),
                _ => null,
            },
            _ => type switch
            {
                TargetType.OwnHero => gp,
                TargetType.FriendlyCard => gp.FindBoardCard(targetCid),
                _ => null,
            },
        };
        if (target is null)
        {
            Tell(player, power.Target == "enemy" ? $"{power.Name} targets an enemy!" : $"{power.Name} targets a friendly card or your hero!");
            return false;
        }

        gp.Mana -= GameRules.HeroPowerCost;
        gp.HeroPowerUsed = true;
        gp.AbilitiesUsed++;
        room.Event("heroPower", new JsonObject { ["id"] = gp.Ident, ["power"] = gp.Type, ["name"] = power.Name, ["dst"] = Ref(target) });
        var text = $"{gp.Name} uses {power.Name} on {NameOf(target)}.";
        room.Logger.Add(GameLogKind.HeroPower, player.Id, target is Card c ? c.Id : room.PlayerOf(((GamePlayer)target).Ident).Id, "Player", target is Card ? "Card" : "Player", text);
        room.LogLine(text);
        switch (gp.Type)
        {
            case 1:
                Damage(room, target, 1, gp, null);
                break;
            case 2:
                Damage(room, target, 1, gp, null);
                Heal(room, gp, 1);
                break;
            case 3:
                Heal(room, target, 2);
                break;
            case 4:
                GainArmor(room, gp, 2);
                break;
        }

        ResolveDeaths(room);
        return true;
    }
}
