using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace Souls.Model.Migrations
{
    /// <inheritdoc />
    public partial class AiCommunity : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "is_ai",
                table: "player",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.CreateTable(
                name: "persona",
                columns: table => new
                {
                    fk_player = table.Column<int>(type: "integer", nullable: false),
                    skill = table.Column<double>(type: "double precision", nullable: false),
                    utc_offset = table.Column<int>(type: "integer", nullable: false),
                    play_from = table.Column<int>(type: "integer", nullable: false),
                    play_hours = table.Column<int>(type: "integer", nullable: false),
                    streak = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_persona", x => x.fk_player);
                    table.ForeignKey(
                        name: "FK_persona_player_fk_player",
                        column: x => x.fk_player,
                        principalTable: "player",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "player_event",
                columns: table => new
                {
                    id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:IdentitySequenceOptions", "'1000', '1', '', '', 'False', '1'")
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    created = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    fk_player = table.Column<int>(type: "integer", nullable: false),
                    kind = table.Column<int>(type: "integer", nullable: false),
                    value = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_player_event", x => x.id);
                    table.ForeignKey(
                        name: "FK_player_event_player_fk_player",
                        column: x => x.fk_player,
                        principalTable: "player",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_player_event_created",
                table: "player_event",
                column: "created");

            migrationBuilder.CreateIndex(
                name: "IX_player_event_fk_player",
                table: "player_event",
                column: "fk_player");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "persona");

            migrationBuilder.DropTable(
                name: "player_event");

            migrationBuilder.DropColumn(
                name: "is_ai",
                table: "player");
        }
    }
}
