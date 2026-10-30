using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Souls.Model.Migrations
{
    /// <inheritdoc />
    public partial class Seasons : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "season",
                columns: table => new
                {
                    number = table.Column<int>(type: "integer", nullable: false),
                    name = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    starts_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    ends_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_season", x => x.number);
                });

            migrationBuilder.CreateTable(
                name: "season_standing",
                columns: table => new
                {
                    fk_season = table.Column<int>(type: "integer", nullable: false),
                    fk_player = table.Column<int>(type: "integer", nullable: false),
                    position = table.Column<int>(type: "integer", nullable: false),
                    rating = table.Column<int>(type: "integer", nullable: false),
                    rank = table.Column<int>(type: "integer", nullable: false),
                    games = table.Column<int>(type: "integer", nullable: false),
                    wins = table.Column<int>(type: "integer", nullable: false),
                    reward_coins = table.Column<int>(type: "integer", nullable: false),
                    fk_reward_card = table.Column<int>(type: "integer", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_season_standing", x => new { x.fk_season, x.fk_player });
                    table.ForeignKey(
                        name: "FK_season_standing_card_fk_reward_card",
                        column: x => x.fk_reward_card,
                        principalTable: "card",
                        principalColumn: "id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "FK_season_standing_player_fk_player",
                        column: x => x.fk_player,
                        principalTable: "player",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_season_standing_season_fk_season",
                        column: x => x.fk_season,
                        principalTable: "season",
                        principalColumn: "number",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_season_standing_fk_player",
                table: "season_standing",
                column: "fk_player");

            migrationBuilder.CreateIndex(
                name: "IX_season_standing_fk_reward_card",
                table: "season_standing",
                column: "fk_reward_card");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "season_standing");

            migrationBuilder.DropTable(
                name: "season");
        }
    }
}
