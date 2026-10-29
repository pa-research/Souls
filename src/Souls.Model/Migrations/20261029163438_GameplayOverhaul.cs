using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

#pragma warning disable CA1814 // Prefer jagged arrays over multidimensional

namespace Souls.Model.Migrations
{
    /// <inheritdoc />
    public partial class GameplayOverhaul : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "level",
                table: "player_cards",
                type: "integer",
                nullable: false,
                defaultValue: 1);

            migrationBuilder.AddColumn<int>(
                name: "rating",
                table: "player",
                type: "integer",
                nullable: false,
                defaultValue: 1000);

            migrationBuilder.AddColumn<string>(
                name: "text",
                table: "game_log",
                type: "character varying(500)",
                maxLength: 500,
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "fk_winner",
                table: "game",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "is_practice",
                table: "game",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<int>(
                name: "player1_rating_change",
                table: "game",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<int>(
                name: "player2_rating_change",
                table: "game",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<int>(
                name: "turns",
                table: "game",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.CreateTable(
                name: "deck_card",
                columns: table => new
                {
                    fk_player = table.Column<int>(type: "integer", nullable: false),
                    fk_card = table.Column<int>(type: "integer", nullable: false),
                    count = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_deck_card", x => new { x.fk_player, x.fk_card });
                    table.ForeignKey(
                        name: "FK_deck_card_card_fk_card",
                        column: x => x.fk_card,
                        principalTable: "card",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_deck_card_player_fk_player",
                        column: x => x.fk_player,
                        principalTable: "player",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "game_replay",
                columns: table => new
                {
                    fk_game = table.Column<int>(type: "integer", nullable: false),
                    data = table.Column<string>(type: "text", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_game_replay", x => x.fk_game);
                    table.ForeignKey(
                        name: "FK_game_replay_game_fk_game",
                        column: x => x.fk_game,
                        principalTable: "game",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "player_quest",
                columns: table => new
                {
                    id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:IdentitySequenceOptions", "'1000', '1', '', '', 'False', '1'")
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    fk_player = table.Column<int>(type: "integer", nullable: false),
                    kind = table.Column<int>(type: "integer", nullable: false),
                    day = table.Column<DateOnly>(type: "date", nullable: false),
                    progress = table.Column<int>(type: "integer", nullable: false),
                    completed_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_player_quest", x => x.id);
                    table.ForeignKey(
                        name: "FK_player_quest_player_fk_player",
                        column: x => x.fk_player,
                        principalTable: "player",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.InsertData(
                table: "ability",
                columns: new[] { "id", "name", "parameter" },
                values: new object[,]
                {
                    { 3, "Taunt", null },
                    { 4, "Summon", null },
                    { 5, "Paralyze", null },
                    { 6, "Haunt", null },
                    { 7, "Harden", null },
                    { 8, "Burn", null },
                    { 9, "Charge", null }
                });

            migrationBuilder.UpdateData(
                table: "card",
                keyColumn: "id",
                keyValue: 1,
                column: "name",
                value: "Snokulv");

            migrationBuilder.UpdateData(
                table: "card",
                keyColumn: "id",
                keyValue: 2,
                column: "name",
                value: "Dr. Robotnik");

            migrationBuilder.UpdateData(
                table: "card",
                keyColumn: "id",
                keyValue: 3,
                column: "fk_ability",
                value: 4);

            migrationBuilder.UpdateData(
                table: "card",
                keyColumn: "id",
                keyValue: 4,
                column: "fk_ability",
                value: 5);

            migrationBuilder.UpdateData(
                table: "card",
                keyColumn: "id",
                keyValue: 6,
                column: "fk_ability",
                value: 3);

            migrationBuilder.InsertData(
                table: "game_log_type",
                columns: new[] { "id", "description", "text", "title" },
                values: new object[,]
                {
                    { 15, "A card paralyzes X", "{0} paralyzes {1}", "ABILITY_PARALYZE" },
                    { 16, "A card gives X armor", "{0} hardens {1}", "ABILITY_HARDEN" },
                    { 17, "A card burns X", "{0} burns {1}", "ABILITY_BURN" },
                    { 18, "A player uses the hero power", "{0} uses the hero power", "HERO_POWER" },
                    { 19, "A player takes fatigue damage", "{0} takes fatigue damage", "FATIGUE" },
                    { 20, "A player ran out of time", "{0} ran out of time", "TURN_TIMED_OUT" },
                    { 21, "A card summons a token", "{0} summons a Lost Soul", "SUMMON" },
                    { 22, "A card returns to the hand", "{0} returns to the hand", "HAUNT" },
                    { 23, "A drawn card burns (hand full)", "{0} burns a card, the hand is full", "CARD_BURNED" },
                    { 24, "A Darkness card curses X", "{0} curses {1}", "DEATH_CURSE" }
                });

            migrationBuilder.InsertData(
                table: "card",
                columns: new[] { "id", "fk_ability", "armor", "attack", "cost", "health", "level", "name", "portrait", "fk_race", "vendor_price" },
                values: new object[,]
                {
                    { 7, 6, 12, 1, 5, 1, 2, "Anette", "/Content/Images/Card/Portraits/16.jpg", 4, 2 },
                    { 18, 9, 0, 4, 4, 3, 2, "Spirit Wolf", "/Content/Images/Card/Portraits/18.png", 3, 3 }
                });

            migrationBuilder.CreateIndex(
                name: "IX_game_created",
                table: "game",
                column: "created");

            migrationBuilder.CreateIndex(
                name: "IX_game_fk_winner",
                table: "game",
                column: "fk_winner");

            migrationBuilder.CreateIndex(
                name: "IX_deck_card_fk_card",
                table: "deck_card",
                column: "fk_card");

            migrationBuilder.CreateIndex(
                name: "IX_player_quest_fk_player_day_kind",
                table: "player_quest",
                columns: new[] { "fk_player", "day", "kind" },
                unique: true);

            migrationBuilder.AddForeignKey(
                name: "FK_game_player_fk_winner",
                table: "game",
                column: "fk_winner",
                principalTable: "player",
                principalColumn: "id",
                onDelete: ReferentialAction.SetNull);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_game_player_fk_winner",
                table: "game");

            migrationBuilder.DropTable(
                name: "deck_card");

            migrationBuilder.DropTable(
                name: "game_replay");

            migrationBuilder.DropTable(
                name: "player_quest");

            migrationBuilder.DropIndex(
                name: "IX_game_created",
                table: "game");

            migrationBuilder.DropIndex(
                name: "IX_game_fk_winner",
                table: "game");

            migrationBuilder.DeleteData(
                table: "ability",
                keyColumn: "id",
                keyValue: 3);

            migrationBuilder.DeleteData(
                table: "ability",
                keyColumn: "id",
                keyValue: 4);

            migrationBuilder.DeleteData(
                table: "ability",
                keyColumn: "id",
                keyValue: 5);

            migrationBuilder.DeleteData(
                table: "ability",
                keyColumn: "id",
                keyValue: 7);

            migrationBuilder.DeleteData(
                table: "ability",
                keyColumn: "id",
                keyValue: 8);

            migrationBuilder.DeleteData(
                table: "card",
                keyColumn: "id",
                keyValue: 7);

            migrationBuilder.DeleteData(
                table: "card",
                keyColumn: "id",
                keyValue: 18);

            migrationBuilder.DeleteData(
                table: "game_log_type",
                keyColumn: "id",
                keyValue: 15);

            migrationBuilder.DeleteData(
                table: "game_log_type",
                keyColumn: "id",
                keyValue: 16);

            migrationBuilder.DeleteData(
                table: "game_log_type",
                keyColumn: "id",
                keyValue: 17);

            migrationBuilder.DeleteData(
                table: "game_log_type",
                keyColumn: "id",
                keyValue: 18);

            migrationBuilder.DeleteData(
                table: "game_log_type",
                keyColumn: "id",
                keyValue: 19);

            migrationBuilder.DeleteData(
                table: "game_log_type",
                keyColumn: "id",
                keyValue: 20);

            migrationBuilder.DeleteData(
                table: "game_log_type",
                keyColumn: "id",
                keyValue: 21);

            migrationBuilder.DeleteData(
                table: "game_log_type",
                keyColumn: "id",
                keyValue: 22);

            migrationBuilder.DeleteData(
                table: "game_log_type",
                keyColumn: "id",
                keyValue: 23);

            migrationBuilder.DeleteData(
                table: "game_log_type",
                keyColumn: "id",
                keyValue: 24);

            migrationBuilder.DeleteData(
                table: "ability",
                keyColumn: "id",
                keyValue: 6);

            migrationBuilder.DeleteData(
                table: "ability",
                keyColumn: "id",
                keyValue: 9);

            migrationBuilder.DropColumn(
                name: "level",
                table: "player_cards");

            migrationBuilder.DropColumn(
                name: "rating",
                table: "player");

            migrationBuilder.DropColumn(
                name: "text",
                table: "game_log");

            migrationBuilder.DropColumn(
                name: "fk_winner",
                table: "game");

            migrationBuilder.DropColumn(
                name: "is_practice",
                table: "game");

            migrationBuilder.DropColumn(
                name: "player1_rating_change",
                table: "game");

            migrationBuilder.DropColumn(
                name: "player2_rating_change",
                table: "game");

            migrationBuilder.DropColumn(
                name: "turns",
                table: "game");

            migrationBuilder.UpdateData(
                table: "card",
                keyColumn: "id",
                keyValue: 1,
                column: "name",
                value: "Rhino");

            migrationBuilder.UpdateData(
                table: "card",
                keyColumn: "id",
                keyValue: 2,
                column: "name",
                value: "Zebra");

            migrationBuilder.UpdateData(
                table: "card",
                keyColumn: "id",
                keyValue: 3,
                column: "fk_ability",
                value: 2);

            migrationBuilder.UpdateData(
                table: "card",
                keyColumn: "id",
                keyValue: 4,
                column: "fk_ability",
                value: 1);

            migrationBuilder.UpdateData(
                table: "card",
                keyColumn: "id",
                keyValue: 6,
                column: "fk_ability",
                value: 2);
        }
    }
}
