using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Souls.Model.Migrations
{
    /// <inheritdoc />
    public partial class ClassRetune : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.UpdateData(
                table: "card",
                keyColumn: "id",
                keyValue: 1,
                columns: new[] { "attack", "health" },
                values: new object[] { 5, 6 });

            migrationBuilder.UpdateData(
                table: "card",
                keyColumn: "id",
                keyValue: 5,
                column: "attack",
                value: 3);

            migrationBuilder.UpdateData(
                table: "card",
                keyColumn: "id",
                keyValue: 7,
                column: "armor",
                value: 5);

            migrationBuilder.UpdateData(
                table: "card",
                keyColumn: "id",
                keyValue: 28,
                column: "ability_value",
                value: 2);

            migrationBuilder.UpdateData(
                table: "card",
                keyColumn: "id",
                keyValue: 34,
                column: "health",
                value: 2);

            migrationBuilder.UpdateData(
                table: "card",
                keyColumn: "id",
                keyValue: 36,
                column: "health",
                value: 3);

            migrationBuilder.UpdateData(
                table: "card",
                keyColumn: "id",
                keyValue: 38,
                column: "health",
                value: 4);

            migrationBuilder.UpdateData(
                table: "card",
                keyColumn: "id",
                keyValue: 54,
                column: "health",
                value: 5);

            migrationBuilder.UpdateData(
                table: "card",
                keyColumn: "id",
                keyValue: 55,
                column: "attack",
                value: 6);

            migrationBuilder.UpdateData(
                table: "card",
                keyColumn: "id",
                keyValue: 56,
                column: "attack",
                value: 6);

            migrationBuilder.UpdateData(
                table: "card",
                keyColumn: "id",
                keyValue: 66,
                column: "ability_value",
                value: 6);

            migrationBuilder.UpdateData(
                table: "player_type",
                keyColumn: "id",
                keyValue: 1,
                column: "health",
                value: 34);

            migrationBuilder.UpdateData(
                table: "player_type",
                keyColumn: "id",
                keyValue: 3,
                column: "health",
                value: 21);

            migrationBuilder.UpdateData(
                table: "player_type",
                keyColumn: "id",
                keyValue: 4,
                columns: new[] { "attack", "health" },
                values: new object[] { 2, 54 });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.UpdateData(
                table: "card",
                keyColumn: "id",
                keyValue: 1,
                columns: new[] { "attack", "health" },
                values: new object[] { 6, 7 });

            migrationBuilder.UpdateData(
                table: "card",
                keyColumn: "id",
                keyValue: 5,
                column: "attack",
                value: 4);

            migrationBuilder.UpdateData(
                table: "card",
                keyColumn: "id",
                keyValue: 7,
                column: "armor",
                value: 8);

            migrationBuilder.UpdateData(
                table: "card",
                keyColumn: "id",
                keyValue: 28,
                column: "ability_value",
                value: 3);

            migrationBuilder.UpdateData(
                table: "card",
                keyColumn: "id",
                keyValue: 34,
                column: "health",
                value: 3);

            migrationBuilder.UpdateData(
                table: "card",
                keyColumn: "id",
                keyValue: 36,
                column: "health",
                value: 4);

            migrationBuilder.UpdateData(
                table: "card",
                keyColumn: "id",
                keyValue: 38,
                column: "health",
                value: 5);

            migrationBuilder.UpdateData(
                table: "card",
                keyColumn: "id",
                keyValue: 54,
                column: "health",
                value: 6);

            migrationBuilder.UpdateData(
                table: "card",
                keyColumn: "id",
                keyValue: 55,
                column: "attack",
                value: 7);

            migrationBuilder.UpdateData(
                table: "card",
                keyColumn: "id",
                keyValue: 56,
                column: "attack",
                value: 7);

            migrationBuilder.UpdateData(
                table: "card",
                keyColumn: "id",
                keyValue: 66,
                column: "ability_value",
                value: 8);

            migrationBuilder.UpdateData(
                table: "player_type",
                keyColumn: "id",
                keyValue: 1,
                column: "health",
                value: 33);

            migrationBuilder.UpdateData(
                table: "player_type",
                keyColumn: "id",
                keyValue: 3,
                column: "health",
                value: 22);

            migrationBuilder.UpdateData(
                table: "player_type",
                keyColumn: "id",
                keyValue: 4,
                columns: new[] { "attack", "health" },
                values: new object[] { 1, 44 });
        }
    }
}
