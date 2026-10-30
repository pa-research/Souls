using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

#pragma warning disable CA1814 // Prefer jagged arrays over multidimensional

namespace Souls.Model.Migrations
{
    /// <inheritdoc />
    public partial class HeroChoice : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "hero_power",
                table: "player",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "fk_class",
                table: "card",
                type: "integer",
                nullable: true);

            migrationBuilder.UpdateData(
                table: "card",
                keyColumn: "id",
                keyValue: 1,
                column: "fk_class",
                value: null);

            migrationBuilder.UpdateData(
                table: "card",
                keyColumn: "id",
                keyValue: 2,
                column: "fk_class",
                value: null);

            migrationBuilder.UpdateData(
                table: "card",
                keyColumn: "id",
                keyValue: 3,
                column: "fk_class",
                value: null);

            migrationBuilder.UpdateData(
                table: "card",
                keyColumn: "id",
                keyValue: 4,
                column: "fk_class",
                value: null);

            migrationBuilder.UpdateData(
                table: "card",
                keyColumn: "id",
                keyValue: 5,
                column: "fk_class",
                value: null);

            migrationBuilder.UpdateData(
                table: "card",
                keyColumn: "id",
                keyValue: 6,
                column: "fk_class",
                value: null);

            migrationBuilder.UpdateData(
                table: "card",
                keyColumn: "id",
                keyValue: 7,
                column: "fk_class",
                value: null);

            migrationBuilder.UpdateData(
                table: "card",
                keyColumn: "id",
                keyValue: 18,
                column: "fk_class",
                value: null);

            migrationBuilder.UpdateData(
                table: "card",
                keyColumn: "id",
                keyValue: 20,
                column: "fk_class",
                value: null);

            migrationBuilder.UpdateData(
                table: "card",
                keyColumn: "id",
                keyValue: 21,
                column: "fk_class",
                value: null);

            migrationBuilder.UpdateData(
                table: "card",
                keyColumn: "id",
                keyValue: 22,
                column: "fk_class",
                value: null);

            migrationBuilder.UpdateData(
                table: "card",
                keyColumn: "id",
                keyValue: 23,
                column: "fk_class",
                value: null);

            migrationBuilder.UpdateData(
                table: "card",
                keyColumn: "id",
                keyValue: 24,
                column: "fk_class",
                value: null);

            migrationBuilder.UpdateData(
                table: "card",
                keyColumn: "id",
                keyValue: 25,
                column: "fk_class",
                value: null);

            migrationBuilder.UpdateData(
                table: "card",
                keyColumn: "id",
                keyValue: 26,
                column: "fk_class",
                value: null);

            migrationBuilder.UpdateData(
                table: "card",
                keyColumn: "id",
                keyValue: 27,
                column: "fk_class",
                value: null);

            migrationBuilder.UpdateData(
                table: "card",
                keyColumn: "id",
                keyValue: 28,
                column: "fk_class",
                value: null);

            migrationBuilder.UpdateData(
                table: "card",
                keyColumn: "id",
                keyValue: 30,
                column: "fk_class",
                value: null);

            migrationBuilder.UpdateData(
                table: "card",
                keyColumn: "id",
                keyValue: 31,
                column: "fk_class",
                value: null);

            migrationBuilder.UpdateData(
                table: "card",
                keyColumn: "id",
                keyValue: 32,
                column: "fk_class",
                value: null);

            migrationBuilder.UpdateData(
                table: "card",
                keyColumn: "id",
                keyValue: 33,
                column: "fk_class",
                value: null);

            migrationBuilder.UpdateData(
                table: "card",
                keyColumn: "id",
                keyValue: 34,
                column: "fk_class",
                value: null);

            migrationBuilder.UpdateData(
                table: "card",
                keyColumn: "id",
                keyValue: 35,
                column: "fk_class",
                value: null);

            migrationBuilder.UpdateData(
                table: "card",
                keyColumn: "id",
                keyValue: 36,
                column: "fk_class",
                value: null);

            migrationBuilder.UpdateData(
                table: "card",
                keyColumn: "id",
                keyValue: 37,
                column: "fk_class",
                value: null);

            migrationBuilder.UpdateData(
                table: "card",
                keyColumn: "id",
                keyValue: 38,
                column: "fk_class",
                value: null);

            migrationBuilder.UpdateData(
                table: "card",
                keyColumn: "id",
                keyValue: 40,
                column: "fk_class",
                value: null);

            migrationBuilder.UpdateData(
                table: "card",
                keyColumn: "id",
                keyValue: 41,
                column: "fk_class",
                value: null);

            migrationBuilder.UpdateData(
                table: "card",
                keyColumn: "id",
                keyValue: 42,
                column: "fk_class",
                value: null);

            migrationBuilder.UpdateData(
                table: "card",
                keyColumn: "id",
                keyValue: 43,
                column: "fk_class",
                value: null);

            migrationBuilder.UpdateData(
                table: "card",
                keyColumn: "id",
                keyValue: 44,
                column: "fk_class",
                value: null);

            migrationBuilder.UpdateData(
                table: "card",
                keyColumn: "id",
                keyValue: 45,
                column: "fk_class",
                value: null);

            migrationBuilder.UpdateData(
                table: "card",
                keyColumn: "id",
                keyValue: 46,
                column: "fk_class",
                value: null);

            migrationBuilder.UpdateData(
                table: "card",
                keyColumn: "id",
                keyValue: 47,
                column: "fk_class",
                value: null);

            migrationBuilder.UpdateData(
                table: "card",
                keyColumn: "id",
                keyValue: 50,
                column: "fk_class",
                value: null);

            migrationBuilder.UpdateData(
                table: "card",
                keyColumn: "id",
                keyValue: 51,
                column: "fk_class",
                value: null);

            migrationBuilder.UpdateData(
                table: "card",
                keyColumn: "id",
                keyValue: 52,
                column: "fk_class",
                value: null);

            migrationBuilder.UpdateData(
                table: "card",
                keyColumn: "id",
                keyValue: 53,
                column: "fk_class",
                value: null);

            migrationBuilder.UpdateData(
                table: "card",
                keyColumn: "id",
                keyValue: 54,
                column: "fk_class",
                value: null);

            migrationBuilder.UpdateData(
                table: "card",
                keyColumn: "id",
                keyValue: 55,
                column: "fk_class",
                value: null);

            migrationBuilder.UpdateData(
                table: "card",
                keyColumn: "id",
                keyValue: 56,
                column: "fk_class",
                value: null);

            migrationBuilder.UpdateData(
                table: "card",
                keyColumn: "id",
                keyValue: 60,
                column: "fk_class",
                value: null);

            migrationBuilder.UpdateData(
                table: "card",
                keyColumn: "id",
                keyValue: 61,
                column: "fk_class",
                value: null);

            migrationBuilder.UpdateData(
                table: "card",
                keyColumn: "id",
                keyValue: 62,
                column: "fk_class",
                value: null);

            migrationBuilder.UpdateData(
                table: "card",
                keyColumn: "id",
                keyValue: 63,
                column: "fk_class",
                value: null);

            migrationBuilder.UpdateData(
                table: "card",
                keyColumn: "id",
                keyValue: 64,
                column: "fk_class",
                value: null);

            migrationBuilder.UpdateData(
                table: "card",
                keyColumn: "id",
                keyValue: 65,
                column: "fk_class",
                value: null);

            migrationBuilder.UpdateData(
                table: "card",
                keyColumn: "id",
                keyValue: 66,
                column: "fk_class",
                value: null);

            migrationBuilder.UpdateData(
                table: "card",
                keyColumn: "id",
                keyValue: 67,
                column: "fk_class",
                value: null);

            migrationBuilder.UpdateData(
                table: "card",
                keyColumn: "id",
                keyValue: 68,
                column: "fk_class",
                value: null);

            migrationBuilder.UpdateData(
                table: "card",
                keyColumn: "id",
                keyValue: 69,
                column: "fk_class",
                value: null);

            migrationBuilder.InsertData(
                table: "card",
                columns: new[] { "id", "fk_ability", "ability_value", "armor", "attack", "fk_class", "cost", "flavor", "health", "kind", "level", "name", "portrait", "fk_race", "rarity", "vendor_price" },
                values: new object[,]
                {
                    { 70, 9, null, 0, 3, 1, 2, "It smelled the battle three graveyards away.", 1, 0, 2, "Rabid Ghoul", "/Content/Images/Card/Portraits/70.jpg", 1, 1, 2 },
                    { 71, 11, null, 0, 4, 1, 4, "It strikes twice: once in the dark, once in your dreams.", 3, 0, 2, "Night Terror", "/Content/Images/Card/Portraits/71.jpg", 1, 2, 4 },
                    { 72, 5, null, 0, 2, 2, 3, "You never see the Lurker's hunters. You only stop moving.", 3, 0, 2, "Night Stalker", "/Content/Images/Card/Portraits/72.jpg", 2, 1, 2 },
                    { 73, 18, 2, 0, 0, 2, 3, "The Lurker drinks twice: once from the wound, once from the fear.", 0, 1, 2, "Crimson Feast", "/Content/Images/Card/Portraits/73.jpg", 2, 2, 4 },
                    { 74, 8, 2, 0, 0, 3, 2, "Harrison throws it like he swings his sword: straight and without mercy.", 0, 1, 2, "Sunlance", "/Content/Images/Card/Portraits/74.jpg", 3, 1, 2 },
                    { 75, 18, 2, 0, 4, 3, 5, "Every blow he lands closes one of Harrison's wounds.", 5, 0, 2, "Dawn Paladin", "/Content/Images/Card/Portraits/75.jpg", 3, 3, 6 },
                    { 76, 6, null, 0, 3, 4, 3, "Kill it and it fades. Turn around and it is back.", 2, 0, 2, "Phantom Wolf", "/Content/Images/Card/Portraits/76.jpg", 4, 1, 2 },
                    { 77, 7, 3, 0, 3, 4, 4, "Fader's bears sleep in armor. They wake up in more.", 5, 0, 2, "Ironhide Bear", "/Content/Images/Card/Portraits/77.jpg", 4, 2, 4 }
                });

            migrationBuilder.CreateIndex(
                name: "IX_card_fk_class",
                table: "card",
                column: "fk_class");

            migrationBuilder.AddForeignKey(
                name: "FK_card_player_type_fk_class",
                table: "card",
                column: "fk_class",
                principalTable: "player_type",
                principalColumn: "id",
                onDelete: ReferentialAction.SetNull);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_card_player_type_fk_class",
                table: "card");

            migrationBuilder.DropIndex(
                name: "IX_card_fk_class",
                table: "card");

            migrationBuilder.DeleteData(
                table: "card",
                keyColumn: "id",
                keyValue: 70);

            migrationBuilder.DeleteData(
                table: "card",
                keyColumn: "id",
                keyValue: 71);

            migrationBuilder.DeleteData(
                table: "card",
                keyColumn: "id",
                keyValue: 72);

            migrationBuilder.DeleteData(
                table: "card",
                keyColumn: "id",
                keyValue: 73);

            migrationBuilder.DeleteData(
                table: "card",
                keyColumn: "id",
                keyValue: 74);

            migrationBuilder.DeleteData(
                table: "card",
                keyColumn: "id",
                keyValue: 75);

            migrationBuilder.DeleteData(
                table: "card",
                keyColumn: "id",
                keyValue: 76);

            migrationBuilder.DeleteData(
                table: "card",
                keyColumn: "id",
                keyValue: 77);

            migrationBuilder.DropColumn(
                name: "hero_power",
                table: "player");

            migrationBuilder.DropColumn(
                name: "fk_class",
                table: "card");
        }
    }
}
