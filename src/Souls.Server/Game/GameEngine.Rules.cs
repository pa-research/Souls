using System.Text.Json.Nodes;
using Souls.Model;
using Souls.Model.Localization;
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
        if (room.Live)
        {
            room.Event("attack", new JsonObject { ["src"] = Ref(attacker), ["dst"] = Ref(defender) });
        }
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
                if (room.Live)
                {
                    room.Event("ward", new JsonObject { ["to"] = Ref(warded), ["on"] = false });
                    room.LogLine(new GameText("log.wardBreaks", ("card", warded.Name)));
                }
                return;
            case Card c:
                absorbed = Math.Min(c.Armor, amount);
                c.Armor -= absorbed;
                c.Health -= amount - absorbed;
                if (room.Live)
                {
                    room.Event("damage", new JsonObject { ["to"] = Ref(c), ["amount"] = amount, ["armorLost"] = absorbed, ["health"] = c.Health, ["armor"] = c.Armor });
                }
                if (sourceCard is { HasVenom: true } && c.Health > 0)
                {
                    c.Health = 0;
                    if (room.Live)
                    {
                        room.Event("venom", new JsonObject { ["src"] = Ref(sourceCard), ["to"] = Ref(c) });
                        room.LogLine(new GameText("log.venom", ("card", sourceCard.Name), ("target", c.Name)));
                    }
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

                if (room.Live)
                {
                    room.Event("damage", new JsonObject { ["to"] = Ref(h), ["amount"] = amount, ["armorLost"] = absorbed, ["health"] = h.Health, ["armor"] = h.Armor });
                }
                break;
        }

        if (sourceCard is { RaceId: Races.Vampiric, IsToken: false } && sourceSide is not null)
        {
            var healed = Heal(room, sourceSide, amount, emit: false);
            if (healed > 0)
            {
                if (room.Live)
                {
                    room.Event("lifesteal", new JsonObject { ["src"] = Ref(sourceCard), ["to"] = Ref(sourceSide), ["amount"] = healed, ["health"] = sourceSide.Health });
                    room.LogLine(new GameText("log.lifesteal", ("card", sourceCard.Name), ("n", healed), ("player", sourceSide.Name)));
                }
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
                if (emit && room.Live)
                {
                    room.Event("heal", new JsonObject { ["to"] = Ref(c), ["amount"] = healed, ["health"] = c.Health });
                }

                return healed;
            case GamePlayer h:
                healed = Math.Clamp(h.MaxHealth - h.Health, 0, amount);
                h.Health += healed;
                if (emit && room.Live)
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

        if (room.Live)
        {
            room.Event("armor", new JsonObject { ["to"] = Ref(target), ["amount"] = amount, ["armor"] = armor });
        }
    }

    /// <summary>
    /// Removes dead cards until none are left: Haunt cards return to the hand once, Brood cards leave Lost Souls
    /// behind and Darkness cards curse a random enemy as they die. Dead heroes are handled by
    /// <see cref="FinishAction"/>.
    /// </summary>
    private void ResolveDeaths(GameRoom room)
    {
        var current = room.CurrentPlaying.GPlayer!;
        var other = room.Other(current);
        if (!HasDead(current) && !HasDead(other))
        {
            return; // the usual case, checked without allocating: this runs after every action, also in the lookahead
        }

        GamePlayer[] sides = [current, other];
        for (var guard = 0; guard < 50; guard++)
        {
            // The dead of each side in slot order, the current player's first.
            var dead = new List<(GamePlayer side, Card card)>();
            foreach (var side in sides)
            {
                var start = dead.Count;
                foreach (var c in side.BoardCards.Values)
                {
                    if (c.Health < 1 && !c.IsDead)
                    {
                        dead.Add((side, c));
                    }
                }

                dead.Sort(start, dead.Count - start, BySlot);
            }

            if (dead.Count == 0)
            {
                return;
            }

            foreach (var (side, card) in dead)
            {
                card.IsDead = true;
                side.RemoveBoardCard(card);
                room.Other(side).CardsDestroyed++;
                if (room.Live)
                {
                    room.Event("death", new JsonObject { ["cid"] = card.Cid, ["owner"] = side.Ident });
                    room.LogLine(new GameText("log.dies", ("card", card.Name)));
                }
            }

            foreach (var (side, card) in dead)
            {
                if (card.AbilityId == Ability.Haunt && !card.Haunted && !card.IsToken)
                {
                    ReturnToHand(room, side, card);
                }
            }

            foreach (var (side, card) in dead)
            {
                if (card.AbilityId == Ability.Brood)
                {
                    Trigger(room, card);
                    SummonLostSouls(room, side, card, card.AbilityValue, card.SlotId);
                }
            }

            foreach (var (side, card) in dead)
            {
                if (card.RaceId != Races.Darkness || card.IsToken)
                {
                    continue;
                }

                var enemy = room.Other(side);
                var targets = enemy.BoardCards.Values.Where(c => c.Health >= 1).Cast<object>().Append(enemy).ToList();
                var target = targets[room.Random.Next(targets.Count)];
                if (room.Live)
                {
                    room.Event("curse", new JsonObject { ["src"] = card.Cid, ["owner"] = side.Ident, ["dst"] = Ref(target) });
                    var text = new GameText("log.deathCurse", ("card", card.Name), ("target", NameOf(target)));
                    room.Logger.Add(GameLogKind.DeathCurse, card.Id, target is Card tc ? tc.Id : room.PlayerOf(enemy.Ident).Id, "Card", target is Card ? "Card" : "Player", text);
                    room.LogLine(text);
                }

                Damage(room, target, GameRules.DeathCurseDamage, side, null);
            }
        }
    }

    private static readonly Comparer<(GamePlayer Side, Card Card)> BySlot = Comparer<(GamePlayer Side, Card Card)>.Create((a, b) => a.Card.SlotId.CompareTo(b.Card.SlotId));

    private static bool HasDead(GamePlayer side)
    {
        foreach (var c in side.BoardCards.Values)
        {
            if (c.Health < 1 && !c.IsDead)
            {
                return true;
            }
        }

        return false;
    }

    /// <summary>Haunt: a fresh copy goes back to the hand (or burns if the hand is full).</summary>
    private void ReturnToHand(GameRoom room, GamePlayer side, Card card)
    {
        var copy = card.NewInstance();
        copy.Haunted = true;
        var owner = room.PlayerOf(side.Ident);
        if (room.Live)
        {
            var text = new GameText("log.haunt", ("card", card.Name), ("player", side.Name));
            room.Logger.Add(GameLogKind.Haunt, card.Id, owner.Id, "Card", "Player", text);
            room.Event("haunt", new JsonObject { ["cid"] = card.Cid, ["newCid"] = copy.Cid, ["owner"] = side.Ident });
            room.LogLine(text);
        }
        if (side.HandCards.Count >= GamePlayer.MaxHandCards)
        {
            Burn(room, side, copy);
            return;
        }

        side.OwnHand()[copy.Cid] = copy;
        if (room.Live)
        {
            room.FlushEvents();
            SendDrawn(owner, [copy], returned: true);
        }
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
                if (room.Live)
                {
                    var text = new GameText("log.fatigue", ("player", gp.Name), ("n", gp.Fatigue));
                    var player = room.PlayerOf(gp.Ident);
                    room.Logger.Add(GameLogKind.Fatigue, player.Id, player.Id, "Player", "Player", text);
                    room.Event("fatigue", new JsonObject { ["id"] = gp.Ident, ["amount"] = gp.Fatigue });
                    room.LogLine(text);
                }
                Damage(room, gp, gp.Fatigue, null, null);
                continue;
            }

            // A copy's deck cards may be shared with other copies (see GamePlayer.Copy): the drawn card is its own.
            var card = room.IsCopy ? gp.Deck[^1].Copy() : gp.Deck[^1];
            gp.OwnDeck().RemoveAt(gp.Deck.Count - 1);
            if (gp.HandCards.Count >= GamePlayer.MaxHandCards)
            {
                Burn(room, gp, card);
                continue;
            }

            gp.OwnHand()[card.Cid] = card;
            drawn.Add(card);
            if (room.Live)
            {
                room.Logger.Add(GameLogKind.NewCard, room.PlayerOf(gp.Ident).Id, card.Id, "Player", "Card");
            }
        }

        if (drawn.Count > 0 && !room.IsCopy)
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
        if (room.Live)
        {
            var text = new GameText("log.burned", ("player", gp.Name), ("card", card.Name));
            room.Logger.Add(GameLogKind.CardBurned, room.PlayerOf(gp.Ident).Id, card.Id, "Player", "Card", text);
            room.Event("burned", new JsonObject { ["owner"] = gp.Ident, ["card"] = card.ToJson() });
            room.LogLine(text);
        }
    }

    /// <summary>A card ability fires on its own (on play, at the start of the turn, on death): shown by the clients.</summary>
    private static void Trigger(GameRoom room, Card card)
    {
        if (!room.Live)
        {
            return;
        }

        var trigger = new JsonObject
        {
            ["abilityId"] = card.AbilityId,
            ["src"] = Ref(card),
            ["label"] = null,
        };
        if (card.AbilityId is { } id)
        {
            GameRules.AbilityLabelText(id, card.AbilityValueOverride).WriteTo(trigger, "label");
        }

        room.Event("trigger", trigger);
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
            if (room.Live)
            {
                room.Event("summon", new JsonObject { ["src"] = source.Cid, ["owner"] = gp.Ident, ["card"] = token.ToJson() });
            }
            summoned++;
        }

        if (summoned > 0 && room.Live)
        {
            var text = new GameText("log.summon", ("card", source.Name), ("n", summoned));
            room.Logger.Add(GameLogKind.Summon, source.Id, source.Id, "Card", "Card", text);
            room.LogLine(text);
        }
    }

    /// <summary>What happens when a card enters the arena: Lightbringer blessing and the on-play abilities.</summary>
    private void OnPlay(GameRoom room, GamePlayer gp, Card card)
    {
        if (card.RaceId == Races.Lightbringer)
        {
            if (room.Live)
            {
                room.Event("blessing", new JsonObject { ["cid"] = card.Cid, ["to"] = Ref(gp) });
            }
            var healed = Heal(room, gp, GameRules.LightbringerBlessing);
            if (healed > 0 && room.Live)
            {
                room.LogLine(new GameText("log.blessing", ("card", card.Name), ("player", gp.Name), ("n", healed)));
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
                    if (room.Live)
                    {
                        room.Event("buff", new JsonObject { ["to"] = Ref(n), ["src"] = Ref(card), ["attack"] = n.Attack, ["health"] = n.Health, ["maxHealth"] = n.MaxHealth, ["armor"] = n.Armor });
                    }
                }

                if (room.Live)
                {
                    LogTrigger(room, card, neighbours.Count == 1
                        ? new GameText("log.rally", ("card", card.Name), ("target", neighbours[0].Name), ("n", value))
                        : new GameText("log.rally2", ("card", card.Name), ("target", neighbours[0].Name), ("target2", neighbours[1].Name), ("n", value)));
                }
                break;
            }

            case Ability.Insight:
                Trigger(room, card);
                if (room.Live)
                {
                    LogTrigger(room, card, new GameText("log.insight", ("card", card.Name), ("n", value)));
                }
                Draw(room, gp, value);
                break;

            case Ability.Inferno:
            {
                var enemy = room.Other(gp);
                var targets = enemy.BoardCards.Values.OrderBy(c => c.SlotId).ToList();
                Trigger(room, card);
                if (room.Live)
                {
                    LogTrigger(room, card, new GameText("log.inferno", ("card", card.Name), ("n", value)));
                }
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
                    if (room.Live)
                    {
                        LogTrigger(room, card, new GameText("log.regenerate", ("card", card.Name), ("n", healed)));
                    }
                    break;
                }

                case Ability.Grow:
                {
                    var value = card.AbilityValue;
                    Trigger(room, card);
                    card.Attack += value;
                    card.Health += value;
                    card.MaxHealth += value;
                    if (room.Live)
                    {
                        room.Event("buff", new JsonObject { ["to"] = Ref(card), ["src"] = Ref(card), ["attack"] = card.Attack, ["health"] = card.Health, ["maxHealth"] = card.MaxHealth, ["armor"] = card.Armor });
                    }
                    if (room.Live)
                    {
                        LogTrigger(room, card, new GameText("log.grow", ("card", card.Name), ("n", value)));
                    }
                    break;
                }
            }
        }
    }

    private static void LogTrigger(GameRoom room, Card card, GameText text)
    {
        room.Logger.Add(GameLogKind.AbilityTriggered, card.Id, card.Id, "Card", "Card", text);
        room.LogLine(text);
    }

    /// <summary>Resolves the ability of a board card. Returns <c>false</c> (and tells the player why) if it cannot be used.</summary>
    private bool UseAbility(GameRoom room, Player player, GamePlayer gp, Card card, TargetType type, int targetCid)
    {
        var target = AbilityTarget(room, gp, card, type, targetCid, out var error);
        if (target is null)
        {
            Tell(player, error!);
            return false;
        }

        gp.AbilitiesUsed++;
        card.HasAttacked = true;
        if (room.Live)
        {
            room.Event("ability", new JsonObject { ["abilityId"] = card.AbilityId, ["src"] = Ref(card), ["dst"] = Ref(target) });
        }

        Activate(room, gp, card, target);
        return true;
    }

    /// <summary>
    /// A spell from the hand: its target is checked like an ability's (on-play spells have none), then it is paid for,
    /// goes to the used pile, blesses (Lightbringer) and works like the ability it carries. It never takes a slot.
    /// </summary>
    private bool TryCastSpell(Player player, GamePlayer gp, Player opponent, Card card, GameAction action)
    {
        var room = gp.GameRoom!;
        if (!gp.HasEnoughMana(card))
        {
            player.Send(new Response(GameResponse.GameUseCardOom, new GameText("error.mana")));
            ReleaseCard(player, opponent, card.Cid);
            return false;
        }

        object? target = null;
        if (GameRules.IsActivated(card.AbilityId))
        {
            target = AbilityTarget(room, gp, card, (TargetType)action.Type, action.Target, out var error);
            if (target is null)
            {
                Tell(player, error!);
                ReleaseCard(player, opponent, card.Cid);
                return false;
            }
        }

        gp.OwnHand().Remove(card.Cid);
        if (room.IsCopy)
        {
            card = card.Copy(); // a copy's hand cards may be shared with other copies (GamePlayer.Copy)
        }

        gp.OwnUsed().Add(card);
        gp.Mana -= card.Cost;
        gp.CardsPlayed++;

        if (room.Live)
        {
            JsonObject Payload() => new() { ["card"] = card.ToJson(), ["pInfo"] = gp.GetPlayerData(), ["target"] = target is null ? null : Ref(target) };
            player.Send(new Response(GameResponse.GameUseCardSpell, Payload()));
            opponent.Send(new Response(GameResponse.GameOpponentUseCardSpell, Payload()));
            var text = target is null
                ? new GameText("log.cast", ("player", gp.Name), ("card", card.Name))
                : new GameText("log.castOn", ("player", gp.Name), ("card", card.Name), ("target", NameOf(target)));
            room.Logger.Add(GameLogKind.UseCard, player.Id, card.Id, "Player", "Card", text);
            room.LogLine(text);
        }

        OnPlay(room, gp, card);
        if (target is not null)
        {
            if (room.Live)
            {
                room.Event("ability", new JsonObject { ["abilityId"] = card.AbilityId, ["src"] = Ref(card), ["dst"] = Ref(target) });
            }

            Activate(room, gp, card, target);
        }

        return true;
    }

    /// <summary>The target of an activated ability (or spell), or <c>null</c> and why it cannot be used there.</summary>
    private static object? AbilityTarget(GameRoom room, GamePlayer gp, Card card, TargetType type, int targetCid, out GameText? error)
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
        error = card.AbilityId switch
        {
            var id when !GameRules.IsActivated(id) => new GameText("error.noAbility"),
            _ when target is null => new GameText("error.pickTarget"),
            { } id when !GameRules.AbilityTargets(id).Contains(targetName) => id switch
            {
                Ability.Heal => new GameText("error.healEnemy"),
                Ability.Harden => new GameText("error.hardenFriendly"),
                Ability.Sacrifice => new GameText("error.sacrificeFriendly"),
                Ability.Paralyze => new GameText("error.paralyzeEnemy"),
                Ability.Burn => new GameText("error.burnEnemy"),
                Ability.Drain => new GameText("error.drainEnemy"),
                Ability.Empower => new GameText("error.empowerFriendly"),
                _ => new GameText("error.pickTarget"),
            },
            Ability.Sacrifice when target == card => new GameText("error.notItself"),
            _ => null,
        };
        return error is null ? target : null;
    }

    /// <summary>What an activated ability (of a board card or a spell) does to its target.</summary>
    private void Activate(GameRoom room, GamePlayer gp, Card card, object target)
    {
        var targetDbId = target is Card tc ? tc.Id : room.PlayerOf(((GamePlayer)target).Ident).Id;
        var targetType = target is Card ? "Card" : "Player";
        switch (card.AbilityId)
        {
            case Ability.Heal:
            {
                var amount = card.AbilityValue + (card.RaceId == Races.Lightbringer ? GameRules.LightbringerHealBonus : 0);
                var healed = Heal(room, target, amount);
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

                if (room.Live)
                {
                    var text = new GameText("log.heal", ("card", card.Name), ("target", NameOf(target)), ("n", healed));
                    room.Logger.Add(GameLogKind.AbilityHeal, card.Id, targetDbId, "Card", targetType, text);
                    room.LogLine(text);
                }

                break;
            }

            case Ability.Sacrifice:
            {
                var text = room.Live ? new GameText("log.sacrifice", ("card", card.Name), ("target", NameOf(target)), ("attack", card.Attack), ("health", Math.Max(0, card.Health)), ("armor", card.Armor)) : null;
                switch (target)
                {
                    case Card t:
                        t.Attack += card.Attack;
                        t.Health += Math.Max(0, card.Health);
                        t.MaxHealth += Math.Max(0, card.Health);
                        t.Armor += card.Armor;
                        if (room.Live)
                        {
                            room.Event("buff", new JsonObject { ["to"] = Ref(t), ["attack"] = t.Attack, ["health"] = t.Health, ["maxHealth"] = t.MaxHealth, ["armor"] = t.Armor });
                        }
                        break;
                    case GamePlayer h:
                        h.Attack += card.Attack;
                        h.Health += Math.Max(0, card.Health);
                        h.MaxHealth += Math.Max(0, card.Health);
                        h.Armor += card.Armor;
                        if (room.Live)
                        {
                            room.Event("buff", new JsonObject { ["to"] = Ref(h), ["attack"] = h.Attack, ["health"] = h.Health, ["maxHealth"] = h.MaxHealth, ["armor"] = h.Armor });
                        }
                        break;
                }

                card.Health = 0;
                if (text is not null)
                {
                    room.Logger.Add(GameLogKind.AbilitySacrifice, card.Id, targetDbId, "Card", targetType, text);
                    room.LogLine(text);
                }
                break;
            }

            case Ability.Paralyze:
            {
                var t = (Card)target;
                t.Paralyzed = true;
                if (room.Live)
                {
                    room.Event("paralyze", new JsonObject { ["cid"] = t.Cid, ["on"] = true });
                    var text = new GameText("log.paralyze", ("card", card.Name), ("target", t.Name));
                    room.Logger.Add(GameLogKind.AbilityParalyze, card.Id, targetDbId, "Card", targetType, text);
                    room.LogLine(text);
                }
                break;
            }

            case Ability.Harden:
            {
                GainArmor(room, target, card.AbilityValue);
                if (room.Live)
                {
                    var text = new GameText("log.harden", ("card", card.Name), ("target", NameOf(target)), ("n", card.AbilityValue));
                    room.Logger.Add(GameLogKind.AbilityHarden, card.Id, targetDbId, "Card", targetType, text);
                    room.LogLine(text);
                }
                break;
            }

            case Ability.Burn:
            {
                if (room.Live)
                {
                    var text = new GameText("log.burn", ("card", card.Name), ("target", NameOf(target)), ("n", card.AbilityValue));
                    room.Logger.Add(GameLogKind.AbilityBurn, card.Id, targetDbId, "Card", targetType, text);
                    room.LogLine(text);
                }
                Damage(room, target, card.AbilityValue, gp, card);
                break;
            }

            case Ability.Drain:
            {
                if (room.Live)
                {
                    var text = new GameText("log.drain", ("card", card.Name), ("target", NameOf(target)), ("n", card.AbilityValue));
                    room.Logger.Add(GameLogKind.AbilityDrain, card.Id, targetDbId, "Card", targetType, text);
                    room.LogLine(text);
                }
                Damage(room, target, card.AbilityValue, gp, card);
                var healed = Heal(room, gp, card.AbilityValue, emit: false);
                if (healed > 0)
                {
                    if (room.Live)
                    {
                        room.Event("lifesteal", new JsonObject { ["src"] = Ref(target), ["to"] = Ref(gp), ["amount"] = healed, ["health"] = gp.Health });
                    }
                }

                break;
            }

            case Ability.Empower:
            {
                var t = (Card)target;
                t.Attack += card.AbilityValue;
                t.Health += card.AbilityValue;
                t.MaxHealth += card.AbilityValue;
                if (room.Live)
                {
                    room.Event("buff", new JsonObject { ["to"] = Ref(t), ["src"] = Ref(card), ["attack"] = t.Attack, ["health"] = t.Health, ["maxHealth"] = t.MaxHealth, ["armor"] = t.Armor });
                }
                if (room.Live)
                {
                    LogTrigger(room, card, new GameText("log.empower", ("card", card.Name), ("target", t.Name), ("n", card.AbilityValue)));
                }
                break;
            }
        }

        ResolveDeaths(room);
    }

    /// <summary>The hero's power (<see cref="GamePlayer.Power"/>). Returns <c>false</c> (and tells the player why) if it cannot be used.</summary>
    private bool UseHeroPower(GameRoom room, Player player, GamePlayer gp, TargetType type, int targetCid)
    {
        if (!GameRules.HeroPowers.TryGetValue(gp.Power, out var power))
        {
            Tell(player, new GameText("error.noPower"));
            return false;
        }

        var enemy = room.Other(gp);
        var kinds = GameRules.PowerTargets(power.Target);
        object? target = kinds.Count == 0 ? gp : type switch
        {
            TargetType.FriendlyCard when kinds.Contains("friendlyCard") => gp.FindBoardCard(targetCid),
            TargetType.OwnHero when kinds.Contains("ownHero") => gp,
            TargetType.EnemyHero when kinds.Contains("enemyHero") => enemy,
            TargetType.EnemyCard when kinds.Contains("enemyCard") => enemy.FindBoardCard(targetCid),
            _ => null,
        };
        if (target is null)
        {
            Tell(player, power.Target switch
            {
                "enemy" => new GameText("error.powerTargetEnemy", ("power", power.Name)),
                "enemyCard" => new GameText("error.powerTargetEnemyCard", ("power", power.Name)),
                "friendlyCard" => new GameText("error.powerTargetFriendlyCard", ("power", power.Name)),
                _ => new GameText("error.powerTargetFriendly", ("power", power.Name)),
            });
            return false;
        }

        if (gp.Power == GameRules.Powers.Aegis && target is Card { Ward: true })
        {
            Tell(player, new GameText("error.hasWard"));
            return false;
        }

        gp.Mana -= GameRules.HeroPowerCost;
        gp.HeroPowerUsed = true;
        gp.AbilitiesUsed++;
        if (room.Live)
        {
            var used = new JsonObject { ["id"] = gp.Ident, ["power"] = gp.Power };
            power.Name.WriteTo(used, "name");
            used["dst"] = Ref(target);
            room.Event("heroPower", used);
            var text = new GameText("log.heroPower", ("player", gp.Name), ("power", power.Name), ("target", NameOf(target)));
            room.Logger.Add(GameLogKind.HeroPower, player.Id, target is Card c ? c.Id : room.PlayerOf(((GamePlayer)target).Ident).Id, "Player", target is Card ? "Card" : "Player", text);
            room.LogLine(text);
        }
        switch (gp.Power)
        {
            case GameRules.Powers.RabidBite:
                Damage(room, target, 1, gp, null);
                break;
            case GameRules.Powers.Drain:
                Damage(room, target, 1, gp, null);
                Heal(room, gp, 1);
                break;
            case GameRules.Powers.HolyLight:
                Heal(room, target, 2);
                break;
            case GameRules.Powers.Fade:
                GainArmor(room, gp, 2);
                break;
            case GameRules.Powers.Ravage:
                Damage(room, target, GameRules.RavageDamage, gp, null);
                Damage(room, gp, GameRules.RavageSelfDamage, null, null);
                break;
            case GameRules.Powers.BloodGift:
            {
                var t = (Card)target;
                t.Attack += GameRules.BloodGiftAttack;
                t.Health += GameRules.BloodGiftHealth;
                t.MaxHealth += GameRules.BloodGiftHealth;
                if (room.Live)
                {
                    room.Event("buff", new JsonObject { ["to"] = Ref(t), ["attack"] = t.Attack, ["health"] = t.Health, ["maxHealth"] = t.MaxHealth, ["armor"] = t.Armor });
                }
                break;
            }

            case GameRules.Powers.Aegis:
                ((Card)target).Ward = true;
                if (room.Live)
                {
                    room.Event("ward", new JsonObject { ["to"] = Ref(target), ["on"] = true });
                }
                break;
            case GameRules.Powers.ThickHide:
                GainArmor(room, target, GameRules.ThickHideArmor);
                break;
        }

        ResolveDeaths(room);
        return true;
    }
}
