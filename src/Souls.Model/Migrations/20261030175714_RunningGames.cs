using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Souls.Model.Migrations
{
    /// <inheritdoc />
    public partial class RunningGames : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "running_game",
                columns: table => new
                {
                    game_id = table.Column<int>(type: "integer", nullable: false),
                    state = table.Column<string>(type: "jsonb", nullable: false),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_running_game", x => x.game_id);
                });

            migrationBuilder.CreateTable(
                name: "running_game_replay",
                columns: table => new
                {
                    fk_running_game = table.Column<int>(type: "integer", nullable: false),
                    seq = table.Column<int>(type: "integer", nullable: false),
                    entry = table.Column<string>(type: "jsonb", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_running_game_replay", x => new { x.fk_running_game, x.seq });
                    table.ForeignKey(
                        name: "FK_running_game_replay_running_game_fk_running_game",
                        column: x => x.fk_running_game,
                        principalTable: "running_game",
                        principalColumn: "game_id",
                        onDelete: ReferentialAction.Cascade);
                });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "running_game_replay");

            migrationBuilder.DropTable(
                name: "running_game");
        }
    }
}
