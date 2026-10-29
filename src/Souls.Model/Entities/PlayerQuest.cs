namespace Souls.Model.Entities;

/// <summary>A daily quest of a player. The reward is paid out when <see cref="Progress"/> reaches the target.</summary>
public class PlayerQuest
{
    public int Id { get; set; }
    public int PlayerId { get; set; }
    public Player? Player { get; set; }
    public QuestKind Kind { get; set; }

    /// <summary>The (UTC) day the quest was handed out; quests expire at the end of it.</summary>
    public DateOnly Day { get; set; }
    public int Progress { get; set; }
    public DateTimeOffset? CompletedAt { get; set; }
}
