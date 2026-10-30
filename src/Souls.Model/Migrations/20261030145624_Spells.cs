using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

#pragma warning disable CA1814 // Prefer jagged arrays over multidimensional

namespace Souls.Model.Migrations
{
    /// <inheritdoc />
    public partial class Spells : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "kind",
                table: "card",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.InsertData(
                table: "ability",
                columns: new[] { "id", "name", "parameter" },
                values: new object[] { 20, "Empower", null });

            migrationBuilder.UpdateData(
                table: "card",
                keyColumn: "id",
                keyValue: 1,
                column: "kind",
                value: 0);

            migrationBuilder.UpdateData(
                table: "card",
                keyColumn: "id",
                keyValue: 2,
                column: "kind",
                value: 0);

            migrationBuilder.UpdateData(
                table: "card",
                keyColumn: "id",
                keyValue: 3,
                column: "kind",
                value: 0);

            migrationBuilder.UpdateData(
                table: "card",
                keyColumn: "id",
                keyValue: 4,
                column: "kind",
                value: 0);

            migrationBuilder.UpdateData(
                table: "card",
                keyColumn: "id",
                keyValue: 5,
                column: "kind",
                value: 0);

            migrationBuilder.UpdateData(
                table: "card",
                keyColumn: "id",
                keyValue: 6,
                column: "kind",
                value: 0);

            migrationBuilder.UpdateData(
                table: "card",
                keyColumn: "id",
                keyValue: 7,
                column: "kind",
                value: 0);

            migrationBuilder.UpdateData(
                table: "card",
                keyColumn: "id",
                keyValue: 18,
                column: "kind",
                value: 0);

            migrationBuilder.UpdateData(
                table: "card",
                keyColumn: "id",
                keyValue: 20,
                column: "kind",
                value: 0);

            migrationBuilder.UpdateData(
                table: "card",
                keyColumn: "id",
                keyValue: 21,
                column: "kind",
                value: 0);

            migrationBuilder.UpdateData(
                table: "card",
                keyColumn: "id",
                keyValue: 22,
                column: "kind",
                value: 0);

            migrationBuilder.UpdateData(
                table: "card",
                keyColumn: "id",
                keyValue: 23,
                column: "kind",
                value: 0);

            migrationBuilder.UpdateData(
                table: "card",
                keyColumn: "id",
                keyValue: 24,
                column: "kind",
                value: 0);

            migrationBuilder.UpdateData(
                table: "card",
                keyColumn: "id",
                keyValue: 25,
                column: "kind",
                value: 0);

            migrationBuilder.UpdateData(
                table: "card",
                keyColumn: "id",
                keyValue: 26,
                column: "kind",
                value: 0);

            migrationBuilder.UpdateData(
                table: "card",
                keyColumn: "id",
                keyValue: 27,
                column: "kind",
                value: 0);

            migrationBuilder.UpdateData(
                table: "card",
                keyColumn: "id",
                keyValue: 28,
                column: "kind",
                value: 0);

            migrationBuilder.UpdateData(
                table: "card",
                keyColumn: "id",
                keyValue: 30,
                column: "kind",
                value: 0);

            migrationBuilder.UpdateData(
                table: "card",
                keyColumn: "id",
                keyValue: 31,
                column: "kind",
                value: 0);

            migrationBuilder.UpdateData(
                table: "card",
                keyColumn: "id",
                keyValue: 32,
                column: "kind",
                value: 0);

            migrationBuilder.UpdateData(
                table: "card",
                keyColumn: "id",
                keyValue: 33,
                column: "kind",
                value: 0);

            migrationBuilder.UpdateData(
                table: "card",
                keyColumn: "id",
                keyValue: 34,
                column: "kind",
                value: 0);

            migrationBuilder.UpdateData(
                table: "card",
                keyColumn: "id",
                keyValue: 35,
                column: "kind",
                value: 0);

            migrationBuilder.UpdateData(
                table: "card",
                keyColumn: "id",
                keyValue: 36,
                column: "kind",
                value: 0);

            migrationBuilder.UpdateData(
                table: "card",
                keyColumn: "id",
                keyValue: 37,
                column: "kind",
                value: 0);

            migrationBuilder.UpdateData(
                table: "card",
                keyColumn: "id",
                keyValue: 38,
                column: "kind",
                value: 0);

            migrationBuilder.UpdateData(
                table: "card",
                keyColumn: "id",
                keyValue: 40,
                column: "kind",
                value: 0);

            migrationBuilder.UpdateData(
                table: "card",
                keyColumn: "id",
                keyValue: 41,
                column: "kind",
                value: 0);

            migrationBuilder.UpdateData(
                table: "card",
                keyColumn: "id",
                keyValue: 42,
                column: "kind",
                value: 0);

            migrationBuilder.UpdateData(
                table: "card",
                keyColumn: "id",
                keyValue: 43,
                column: "kind",
                value: 0);

            migrationBuilder.UpdateData(
                table: "card",
                keyColumn: "id",
                keyValue: 44,
                column: "kind",
                value: 0);

            migrationBuilder.UpdateData(
                table: "card",
                keyColumn: "id",
                keyValue: 45,
                column: "kind",
                value: 0);

            migrationBuilder.UpdateData(
                table: "card",
                keyColumn: "id",
                keyValue: 46,
                column: "kind",
                value: 0);

            migrationBuilder.UpdateData(
                table: "card",
                keyColumn: "id",
                keyValue: 47,
                column: "kind",
                value: 0);

            migrationBuilder.UpdateData(
                table: "card",
                keyColumn: "id",
                keyValue: 50,
                column: "kind",
                value: 0);

            migrationBuilder.UpdateData(
                table: "card",
                keyColumn: "id",
                keyValue: 51,
                column: "kind",
                value: 0);

            migrationBuilder.UpdateData(
                table: "card",
                keyColumn: "id",
                keyValue: 52,
                column: "kind",
                value: 0);

            migrationBuilder.UpdateData(
                table: "card",
                keyColumn: "id",
                keyValue: 53,
                column: "kind",
                value: 0);

            migrationBuilder.UpdateData(
                table: "card",
                keyColumn: "id",
                keyValue: 54,
                column: "kind",
                value: 0);

            migrationBuilder.UpdateData(
                table: "card",
                keyColumn: "id",
                keyValue: 55,
                column: "kind",
                value: 0);

            migrationBuilder.UpdateData(
                table: "card",
                keyColumn: "id",
                keyValue: 56,
                column: "kind",
                value: 0);

            migrationBuilder.InsertData(
                table: "card",
                columns: new[] { "id", "fk_ability", "ability_value", "armor", "attack", "cost", "flavor", "health", "kind", "level", "name", "portrait", "fk_race", "rarity", "vendor_price" },
                values: new object[,]
                {
                    { 60, 8, 4, 0, 0, 4, "It does not cut the flesh. It cuts what lives inside.", 0, 1, 2, "Soul Rend", "/Content/Images/Card/Portraits/60.jpg", 1, 1, 2 },
                    { 61, 18, 2, 0, 0, 3, "Cold fingers close, and something warm flows the other way.", 0, 1, 2, "Death Grip", "/Content/Images/Card/Portraits/61.jpg", 1, 2, 4 },
                    { 62, 15, 2, 0, 0, 2, "It blows from the barrows, and the fields go quiet behind it.", 0, 1, 2, "Plague Wind", "/Content/Images/Card/Portraits/62.jpg", 1, 3, 6 },
                    { 63, 8, 3, 0, 0, 2, "Forged from a single drop, and thirsty for the rest.", 0, 1, 2, "Blood Lance", "/Content/Images/Card/Portraits/63.jpg", 2, 1, 2 },
                    { 65, 15, 2, 0, 0, 2, "When the moon turns red, every wound bleeds for the count.", 0, 1, 2, "Blood Moon", "/Content/Images/Card/Portraits/65.jpg", 2, 3, 6 },
                    { 66, 7, 8, 0, 0, 1, "The light does not ask whether you deserve it.", 0, 1, 2, "Sacred Shield", "/Content/Images/Card/Portraits/66.jpg", 3, 1, 2 },
                    { 67, 14, 3, 0, 0, 2, "For one blinding moment, every path is clear.", 0, 1, 2, "Revelation", "/Content/Images/Card/Portraits/67.jpg", 3, 2, 4 },
                    { 68, 1, 4, 0, 0, 2, "Troll blood closes any wound. The taste is another matter.", 0, 1, 2, "Troll Blood", "/Content/Images/Card/Portraits/68.jpg", 4, 1, 2 },
                    { 69, 5, null, 0, 0, 0, "The cold of the high passes does not kill. It waits.", 0, 1, 2, "Frostbite", "/Content/Images/Card/Portraits/69.jpg", 4, 2, 4 },
                    { 64, 20, 2, 0, 0, 3, "Drink deep, and rise stronger than you fell.", 0, 1, 2, "Blood Pact", "/Content/Images/Card/Portraits/64.jpg", 2, 2, 4 }
                });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DeleteData(
                table: "card",
                keyColumn: "id",
                keyValue: 60);

            migrationBuilder.DeleteData(
                table: "card",
                keyColumn: "id",
                keyValue: 61);

            migrationBuilder.DeleteData(
                table: "card",
                keyColumn: "id",
                keyValue: 62);

            migrationBuilder.DeleteData(
                table: "card",
                keyColumn: "id",
                keyValue: 63);

            migrationBuilder.DeleteData(
                table: "card",
                keyColumn: "id",
                keyValue: 64);

            migrationBuilder.DeleteData(
                table: "card",
                keyColumn: "id",
                keyValue: 65);

            migrationBuilder.DeleteData(
                table: "card",
                keyColumn: "id",
                keyValue: 66);

            migrationBuilder.DeleteData(
                table: "card",
                keyColumn: "id",
                keyValue: 67);

            migrationBuilder.DeleteData(
                table: "card",
                keyColumn: "id",
                keyValue: 68);

            migrationBuilder.DeleteData(
                table: "card",
                keyColumn: "id",
                keyValue: 69);

            migrationBuilder.DeleteData(
                table: "ability",
                keyColumn: "id",
                keyValue: 20);

            migrationBuilder.DropColumn(
                name: "kind",
                table: "card");
        }
    }
}
