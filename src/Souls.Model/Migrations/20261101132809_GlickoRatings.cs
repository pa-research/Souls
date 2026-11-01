using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Souls.Model.Migrations
{
    /// <inheritdoc />
    public partial class GlickoRatings : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "rated_at",
                table: "player",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<double>(
                name: "rating_deviation",
                table: "player",
                type: "double precision",
                nullable: false,
                defaultValue: 350.0);

            migrationBuilder.AddColumn<double>(
                name: "rating_volatility",
                table: "player",
                type: "double precision",
                nullable: false,
                defaultValue: 0.059999999999999998);

            // Players who already played ranked games keep their Elo rating as the Glicko-2 rating, with the deviation of
            // a season's start (Ratings.SeasonDeviation) instead of a new player's; they last played at their last game.
            migrationBuilder.Sql("""
                UPDATE player p SET rating_deviation = 150, rated_at = g.last
                FROM (SELECT x.id, MAX(x.created) AS last FROM (
                        SELECT fk_player1 AS id, created FROM game WHERE NOT is_practice
                        UNION ALL SELECT fk_player2, created FROM game WHERE NOT is_practice) x
                      GROUP BY x.id) g
                WHERE p.id = g.id AND NOT p.is_system;
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "rated_at",
                table: "player");

            migrationBuilder.DropColumn(
                name: "rating_deviation",
                table: "player");

            migrationBuilder.DropColumn(
                name: "rating_volatility",
                table: "player");
        }
    }
}
