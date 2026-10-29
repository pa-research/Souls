namespace Souls.Model.Entities;

/// <summary>Ids of the rows in <c>game_log_type</c>.</summary>
public enum GameLogKind
{
    Won = 1,
    Defeat,
    Draw,
    CardAttackPlayer,
    CardAttackCard,
    PlayerAttackPlayer,
    PlayerAttackCard,
    GameCreated,
    UseCard,
    NextTurn,
    NewCard,
    Kicked,
    AbilityHeal,
    AbilitySacrifice,
    AbilityParalyze,
    AbilityHarden,
    AbilityBurn,
    HeroPower,
    Fatigue,
    TurnTimedOut,
    Summon,
    Haunt,
    CardBurned,
    DeathCurse,
}

public static class GameLogKinds
{
    /// <summary>The legacy upper-case title stored in the database, e.g. <c>CARD_ATTACK_PLAYER</c>.</summary>
    public static string Title(GameLogKind kind) => kind switch
    {
        GameLogKind.Won => "WON",
        GameLogKind.Defeat => "DEFEAT",
        GameLogKind.Draw => "DRAW",
        GameLogKind.CardAttackPlayer => "CARD_ATTACK_PLAYER",
        GameLogKind.CardAttackCard => "CARD_ATTACK_CARD",
        GameLogKind.PlayerAttackPlayer => "PLAYER_ATTACK_PLAYER",
        GameLogKind.PlayerAttackCard => "PLAYER_ATTACK_CARD",
        GameLogKind.GameCreated => "GAME_CREATED",
        GameLogKind.UseCard => "USE_CARD",
        GameLogKind.NextTurn => "NEXT_TURN",
        GameLogKind.NewCard => "NEW_CARD",
        GameLogKind.Kicked => "KICKED",
        GameLogKind.AbilityHeal => "ABILITY_HEAL",
        GameLogKind.AbilitySacrifice => "ABILITY_SACRIFICE",
        GameLogKind.AbilityParalyze => "ABILITY_PARALYZE",
        GameLogKind.AbilityHarden => "ABILITY_HARDEN",
        GameLogKind.AbilityBurn => "ABILITY_BURN",
        GameLogKind.HeroPower => "HERO_POWER",
        GameLogKind.Fatigue => "FATIGUE",
        GameLogKind.TurnTimedOut => "TURN_TIMED_OUT",
        GameLogKind.Summon => "SUMMON",
        GameLogKind.Haunt => "HAUNT",
        GameLogKind.CardBurned => "CARD_BURNED",
        GameLogKind.DeathCurse => "DEATH_CURSE",
        _ => throw new ArgumentOutOfRangeException(nameof(kind), kind, null),
    };
}
