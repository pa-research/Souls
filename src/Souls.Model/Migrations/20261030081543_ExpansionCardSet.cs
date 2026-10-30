using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

#pragma warning disable CA1814 // Prefer jagged arrays over multidimensional

namespace Souls.Model.Migrations
{
    /// <inheritdoc />
    public partial class ExpansionCardSet : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "ability_value",
                table: "card",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "flavor",
                table: "card",
                type: "character varying(500)",
                maxLength: 500,
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "rarity",
                table: "card",
                type: "integer",
                nullable: false,
                defaultValue: 1);

            migrationBuilder.InsertData(
                table: "ability",
                columns: new[] { "id", "name", "parameter" },
                values: new object[,]
                {
                    { 10, "Ward", null },
                    { 11, "Fury", null },
                    { 12, "Venom", null },
                    { 13, "Rally", null },
                    { 14, "Insight", null },
                    { 15, "Inferno", null },
                    { 16, "Regenerate", null },
                    { 17, "Grow", null },
                    { 18, "Drain", null },
                    { 19, "Brood", null }
                });

            migrationBuilder.UpdateData(
                table: "card",
                keyColumn: "id",
                keyValue: 1,
                columns: new[] { "ability_value", "armor", "attack", "flavor", "level", "rarity", "vendor_price" },
                values: new object[] { 2, 1, 6, "The snow wolf of the north: the first card ever drawn in Souls.", 2, 2, 4 });

            migrationBuilder.UpdateData(
                table: "card",
                keyColumn: "id",
                keyValue: 2,
                columns: new[] { "ability_value", "attack", "flavor", "health", "level", "rarity", "vendor_price" },
                values: new object[] { null, 2, "Every great plan needs a volunteer.", 2, 2, 4, 10 });

            migrationBuilder.UpdateData(
                table: "card",
                keyColumn: "id",
                keyValue: 3,
                columns: new[] { "ability_value", "attack", "flavor", "level", "rarity", "vendor_price" },
                values: new object[] { 1, 4, "Per never fights alone.", 2, 2, 4 });

            migrationBuilder.UpdateData(
                table: "card",
                keyColumn: "id",
                keyValue: 4,
                columns: new[] { "ability_value", "armor", "attack", "flavor", "health", "rarity", "vendor_price" },
                values: new object[] { null, 1, 3, "One look, and you forget how to move.", 4, 3, 6 });

            migrationBuilder.UpdateData(
                table: "card",
                keyColumn: "id",
                keyValue: 5,
                columns: new[] { "ability_value", "armor", "attack", "flavor", "rarity", "vendor_price" },
                values: new object[] { 2, 1, 4, "Big hands, gentle heart.", 1, 2 });

            migrationBuilder.UpdateData(
                table: "card",
                keyColumn: "id",
                keyValue: 6,
                columns: new[] { "ability_value", "armor", "attack", "flavor", "rarity", "vendor_price" },
                values: new object[] { null, 0, 1, "Bobby holds the line. Bobby has always held the line.", 1, 2 });

            migrationBuilder.UpdateData(
                table: "card",
                keyColumn: "id",
                keyValue: 7,
                columns: new[] { "ability_value", "armor", "attack", "flavor", "health", "rarity", "vendor_price" },
                values: new object[] { null, 8, 3, "Death is only a short break for Anette.", 2, 3, 6 });

            migrationBuilder.UpdateData(
                table: "card",
                keyColumn: "id",
                keyValue: 18,
                columns: new[] { "ability_value", "flavor", "health", "rarity", "vendor_price" },
                values: new object[] { null, "Promised in 2014. Worth the wait.", 4, 4, 10 });

            migrationBuilder.InsertData(
                table: "card",
                columns: new[] { "id", "fk_ability", "ability_value", "armor", "attack", "cost", "flavor", "health", "level", "name", "portrait", "fk_race", "rarity", "vendor_price" },
                values: new object[,]
                {
                    { 20, null, null, 0, 1, 1, "Small, spiteful and always grinning at a funeral.", 2, 1, "Gloom Imp", "/Content/Images/Card/Portraits/20.jpg", 1, 1, 2 },
                    { 22, 8, 1, 0, 2, 2, "What the lantern misses, the Shade remembers.", 2, 2, "Shade", "/Content/Images/Card/Portraits/22.jpg", 1, 1, 2 },
                    { 23, 6, null, 0, 2, 3, "Barrow-kings never stay buried for long.", 3, 1, "Draugr", "/Content/Images/Card/Portraits/23.jpg", 1, 1, 2 },
                    { 24, 5, null, 0, 2, 3, "She rides the chest of the sleeper until dawn.", 4, 2, "Mara", "/Content/Images/Card/Portraits/24.jpg", 1, 2, 4 },
                    { 26, 3, null, 0, 4, 5, "Built from a thousand fallen champions. None of them agreed to it.", 5, 1, "Bone Colossus", "/Content/Images/Card/Portraits/26.jpg", 1, 1, 2 },
                    { 30, 9, null, 0, 2, 1, "The first drop is always the sweetest.", 1, 2, "Blood Bat", "/Content/Images/Card/Portraits/30.jpg", 2, 1, 2 },
                    { 31, null, null, 0, 2, 2, "He serves the count. He no longer remembers why.", 3, 1, "Blood Thrall", "/Content/Images/Card/Portraits/31.jpg", 2, 1, 2 },
                    { 33, 1, 3, 0, 2, 3, "Drink, and be whole again.", 3, 1, "Blood Priest", "/Content/Images/Card/Portraits/33.jpg", 2, 1, 2 },
                    { 35, 4, 2, 0, 3, 4, "A circle of salt, a cup of blood, and something answers.", 3, 2, "Blood Ritualist", "/Content/Images/Card/Portraits/35.jpg", 2, 2, 4 },
                    { 41, 3, null, 0, 2, 2, "Behind her shield, the line does not break.", 2, 1, "Shieldmaiden", "/Content/Images/Card/Portraits/41.jpg", 3, 1, 2 },
                    { 44, 1, 3, 0, 2, 3, "The sun asks nothing in return. The cleric does.", 3, 2, "Sun Cleric", "/Content/Images/Card/Portraits/44.jpg", 3, 2, 4 },
                    { 46, 7, 3, 2, 4, 6, "Mountains move before the Bastion does.", 6, 2, "Bastion Guardian", "/Content/Images/Card/Portraits/46.jpg", 3, 2, 4 },
                    { 50, 9, null, 0, 1, 1, "Small teeth, big ambitions.", 2, 1, "Wolf Pup", "/Content/Images/Card/Portraits/50.jpg", 4, 1, 2 },
                    { 51, null, null, 0, 3, 2, "It does not stop. It does not turn. It does not care.", 3, 1, "Raging Boar", "/Content/Images/Card/Portraits/51.jpg", 4, 1, 2 },
                    { 55, 3, null, 1, 7, 8, "Older than the mountains, and twice as patient.", 7, 2, "Frost Jotun", "/Content/Images/Card/Portraits/55.jpg", 4, 3, 6 }
                });

            migrationBuilder.InsertData(
                table: "game_log_type",
                columns: new[] { "id", "description", "text", "title" },
                values: new object[,]
                {
                    { 25, "A card ability triggers on its own", "{0}: {1}", "ABILITY_TRIGGERED" },
                    { 26, "A card drains X", "{0} drains {1}", "ABILITY_DRAIN" }
                });

            migrationBuilder.UpdateData(
                table: "player_type",
                keyColumn: "id",
                keyValue: 1,
                columns: new[] { "armor", "attack", "health" },
                values: new object[] { 0, 3, 33 });

            migrationBuilder.UpdateData(
                table: "player_type",
                keyColumn: "id",
                keyValue: 2,
                columns: new[] { "armor", "health" },
                values: new object[] { 2, 33 });

            migrationBuilder.UpdateData(
                table: "player_type",
                keyColumn: "id",
                keyValue: 3,
                columns: new[] { "attack", "health" },
                values: new object[] { 5, 22 });

            migrationBuilder.UpdateData(
                table: "player_type",
                keyColumn: "id",
                keyValue: 4,
                columns: new[] { "armor", "health" },
                values: new object[] { 6, 44 });

            migrationBuilder.InsertData(
                table: "card",
                columns: new[] { "id", "fk_ability", "ability_value", "armor", "attack", "cost", "flavor", "health", "level", "name", "portrait", "fk_race", "rarity", "vendor_price" },
                values: new object[,]
                {
                    { 21, 12, null, 0, 1, 2, "It has eaten better men than you. Mostly afterwards.", 2, 2, "Grave Rat", "/Content/Images/Card/Portraits/21.jpg", 1, 1, 2 },
                    { 25, 19, 2, 0, 2, 4, "Every grave is a door, if you know how to knock.", 5, 2, "Gravecaller", "/Content/Images/Card/Portraits/25.jpg", 1, 2, 4 },
                    { 27, 15, 2, 0, 4, 6, "Where she rakes, a few survive. Where she sweeps, nobody does.", 5, 2, "Pesta", "/Content/Images/Card/Portraits/27.jpg", 1, 3, 6 },
                    { 28, 18, 3, 0, 6, 7, "Every soul in the arena is already on his list.", 6, 2, "The Pale Reaper", "/Content/Images/Card/Portraits/28.jpg", 1, 4, 10 },
                    { 32, 11, null, 0, 3, 3, "Hers is the last kiss they ever feel twice.", 2, 2, "Vampire Bride", "/Content/Images/Card/Portraits/32.jpg", 2, 2, 4 },
                    { 34, 10, null, 0, 3, 4, "First blood is a matter of honour. Hers.", 3, 2, "Crimson Duelist", "/Content/Images/Card/Portraits/34.jpg", 2, 2, 4 },
                    { 36, 16, 2, 1, 4, 5, "His wounds close before his enemies can boast of them.", 4, 2, "Sanguine Knight", "/Content/Images/Card/Portraits/36.jpg", 2, 1, 2 },
                    { 37, 17, 1, 0, 4, 6, "Every night the count grows older. And stronger.", 5, 2, "Lord Varga", "/Content/Images/Card/Portraits/37.jpg", 2, 4, 10 },
                    { 38, 11, null, 0, 5, 7, "The plague follows him like a loyal dog.", 5, 2, "Nosferatu", "/Content/Images/Card/Portraits/38.jpg", 2, 3, 6 },
                    { 40, 13, 1, 0, 1, 1, "One horn call, and the faithful stand taller.", 1, 1, "Acolyte of Dawn", "/Content/Images/Card/Portraits/40.jpg", 3, 1, 2 },
                    { 42, 14, 1, 0, 1, 2, "Follow the lantern and you find what you were looking for.", 1, 2, "Lantern Bearer", "/Content/Images/Card/Portraits/42.jpg", 3, 1, 2 },
                    { 43, 10, null, 0, 2, 3, "Faith is the first shield. Steel is the second.", 3, 1, "Templar", "/Content/Images/Card/Portraits/43.jpg", 3, 1, 2 },
                    { 45, 11, null, 0, 4, 5, "She chooses who falls. Today she chose your army.", 5, 2, "Valkyrie", "/Content/Images/Card/Portraits/45.jpg", 3, 3, 6 },
                    { 47, 15, 2, 1, 5, 8, "Judgement comes on burning wings.", 5, 2, "Archangel", "/Content/Images/Card/Portraits/47.jpg", 3, 4, 10 },
                    { 52, 12, null, 0, 2, 3, "Lovely from the front. Never look behind her.", 3, 2, "Huldra", "/Content/Images/Card/Portraits/52.jpg", 4, 2, 4 },
                    { 53, 16, 2, 0, 4, 4, "Cut it down and it grows back meaner.", 5, 2, "Forest Troll", "/Content/Images/Card/Portraits/53.jpg", 4, 1, 2 },
                    { 54, 13, 1, 1, 4, 5, "When the chieftain roars, the whole mountain answers.", 6, 2, "Troll Chieftain", "/Content/Images/Card/Portraits/54.jpg", 4, 2, 4 },
                    { 56, 11, null, 0, 7, 9, "No chain forged by gods or men holds him for long.", 8, 2, "Fenrir", "/Content/Images/Card/Portraits/56.jpg", 4, 4, 10 }
                });

            // Rarer cards allow fewer copies in a deck, so a collection of five cards may no longer fill one. Every
            // player gets the common starter cards they do not own yet.
            migrationBuilder.Sql("""
                INSERT INTO player_cards (fk_player, fk_card, obtained_at, level)
                SELECT p.id, c.id, now(), 1
                FROM player p CROSS JOIN card c
                WHERE NOT p.is_system AND c.level = 1 AND c.rarity = 1
                  AND NOT EXISTS (SELECT 1 FROM player_cards pc WHERE pc.fk_player = p.id AND pc.fk_card = c.id);
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DeleteData(
                table: "card",
                keyColumn: "id",
                keyValue: 20);

            migrationBuilder.DeleteData(
                table: "card",
                keyColumn: "id",
                keyValue: 21);

            migrationBuilder.DeleteData(
                table: "card",
                keyColumn: "id",
                keyValue: 22);

            migrationBuilder.DeleteData(
                table: "card",
                keyColumn: "id",
                keyValue: 23);

            migrationBuilder.DeleteData(
                table: "card",
                keyColumn: "id",
                keyValue: 24);

            migrationBuilder.DeleteData(
                table: "card",
                keyColumn: "id",
                keyValue: 25);

            migrationBuilder.DeleteData(
                table: "card",
                keyColumn: "id",
                keyValue: 26);

            migrationBuilder.DeleteData(
                table: "card",
                keyColumn: "id",
                keyValue: 27);

            migrationBuilder.DeleteData(
                table: "card",
                keyColumn: "id",
                keyValue: 28);

            migrationBuilder.DeleteData(
                table: "card",
                keyColumn: "id",
                keyValue: 30);

            migrationBuilder.DeleteData(
                table: "card",
                keyColumn: "id",
                keyValue: 31);

            migrationBuilder.DeleteData(
                table: "card",
                keyColumn: "id",
                keyValue: 32);

            migrationBuilder.DeleteData(
                table: "card",
                keyColumn: "id",
                keyValue: 33);

            migrationBuilder.DeleteData(
                table: "card",
                keyColumn: "id",
                keyValue: 34);

            migrationBuilder.DeleteData(
                table: "card",
                keyColumn: "id",
                keyValue: 35);

            migrationBuilder.DeleteData(
                table: "card",
                keyColumn: "id",
                keyValue: 36);

            migrationBuilder.DeleteData(
                table: "card",
                keyColumn: "id",
                keyValue: 37);

            migrationBuilder.DeleteData(
                table: "card",
                keyColumn: "id",
                keyValue: 38);

            migrationBuilder.DeleteData(
                table: "card",
                keyColumn: "id",
                keyValue: 40);

            migrationBuilder.DeleteData(
                table: "card",
                keyColumn: "id",
                keyValue: 41);

            migrationBuilder.DeleteData(
                table: "card",
                keyColumn: "id",
                keyValue: 42);

            migrationBuilder.DeleteData(
                table: "card",
                keyColumn: "id",
                keyValue: 43);

            migrationBuilder.DeleteData(
                table: "card",
                keyColumn: "id",
                keyValue: 44);

            migrationBuilder.DeleteData(
                table: "card",
                keyColumn: "id",
                keyValue: 45);

            migrationBuilder.DeleteData(
                table: "card",
                keyColumn: "id",
                keyValue: 46);

            migrationBuilder.DeleteData(
                table: "card",
                keyColumn: "id",
                keyValue: 47);

            migrationBuilder.DeleteData(
                table: "card",
                keyColumn: "id",
                keyValue: 50);

            migrationBuilder.DeleteData(
                table: "card",
                keyColumn: "id",
                keyValue: 51);

            migrationBuilder.DeleteData(
                table: "card",
                keyColumn: "id",
                keyValue: 52);

            migrationBuilder.DeleteData(
                table: "card",
                keyColumn: "id",
                keyValue: 53);

            migrationBuilder.DeleteData(
                table: "card",
                keyColumn: "id",
                keyValue: 54);

            migrationBuilder.DeleteData(
                table: "card",
                keyColumn: "id",
                keyValue: 55);

            migrationBuilder.DeleteData(
                table: "card",
                keyColumn: "id",
                keyValue: 56);

            migrationBuilder.DeleteData(
                table: "game_log_type",
                keyColumn: "id",
                keyValue: 25);

            migrationBuilder.DeleteData(
                table: "game_log_type",
                keyColumn: "id",
                keyValue: 26);

            migrationBuilder.DeleteData(
                table: "ability",
                keyColumn: "id",
                keyValue: 10);

            migrationBuilder.DeleteData(
                table: "ability",
                keyColumn: "id",
                keyValue: 11);

            migrationBuilder.DeleteData(
                table: "ability",
                keyColumn: "id",
                keyValue: 12);

            migrationBuilder.DeleteData(
                table: "ability",
                keyColumn: "id",
                keyValue: 13);

            migrationBuilder.DeleteData(
                table: "ability",
                keyColumn: "id",
                keyValue: 14);

            migrationBuilder.DeleteData(
                table: "ability",
                keyColumn: "id",
                keyValue: 15);

            migrationBuilder.DeleteData(
                table: "ability",
                keyColumn: "id",
                keyValue: 16);

            migrationBuilder.DeleteData(
                table: "ability",
                keyColumn: "id",
                keyValue: 17);

            migrationBuilder.DeleteData(
                table: "ability",
                keyColumn: "id",
                keyValue: 18);

            migrationBuilder.DeleteData(
                table: "ability",
                keyColumn: "id",
                keyValue: 19);

            migrationBuilder.DropColumn(
                name: "ability_value",
                table: "card");

            migrationBuilder.DropColumn(
                name: "flavor",
                table: "card");

            migrationBuilder.DropColumn(
                name: "rarity",
                table: "card");

            migrationBuilder.UpdateData(
                table: "card",
                keyColumn: "id",
                keyValue: 1,
                columns: new[] { "armor", "attack", "level", "vendor_price" },
                values: new object[] { 3, 5, 1, 1 });

            migrationBuilder.UpdateData(
                table: "card",
                keyColumn: "id",
                keyValue: 2,
                columns: new[] { "attack", "health", "level", "vendor_price" },
                values: new object[] { 1, 1, 1, 1 });

            migrationBuilder.UpdateData(
                table: "card",
                keyColumn: "id",
                keyValue: 3,
                columns: new[] { "attack", "level", "vendor_price" },
                values: new object[] { 6, 1, 1 });

            migrationBuilder.UpdateData(
                table: "card",
                keyColumn: "id",
                keyValue: 4,
                columns: new[] { "armor", "attack", "health", "vendor_price" },
                values: new object[] { 2, 5, 5, 3 });

            migrationBuilder.UpdateData(
                table: "card",
                keyColumn: "id",
                keyValue: 5,
                columns: new[] { "armor", "attack", "vendor_price" },
                values: new object[] { 2, 3, 1 });

            migrationBuilder.UpdateData(
                table: "card",
                keyColumn: "id",
                keyValue: 6,
                columns: new[] { "armor", "attack", "vendor_price" },
                values: new object[] { 1, 2, 1 });

            migrationBuilder.UpdateData(
                table: "card",
                keyColumn: "id",
                keyValue: 7,
                columns: new[] { "armor", "attack", "health", "vendor_price" },
                values: new object[] { 12, 1, 1, 2 });

            migrationBuilder.UpdateData(
                table: "card",
                keyColumn: "id",
                keyValue: 18,
                columns: new[] { "health", "vendor_price" },
                values: new object[] { 3, 3 });

            migrationBuilder.UpdateData(
                table: "player_type",
                keyColumn: "id",
                keyValue: 1,
                columns: new[] { "armor", "attack", "health" },
                values: new object[] { 2, 5, 20 });

            migrationBuilder.UpdateData(
                table: "player_type",
                keyColumn: "id",
                keyValue: 2,
                columns: new[] { "armor", "health" },
                values: new object[] { 4, 35 });

            migrationBuilder.UpdateData(
                table: "player_type",
                keyColumn: "id",
                keyValue: 3,
                columns: new[] { "attack", "health" },
                values: new object[] { 10, 10 });

            migrationBuilder.UpdateData(
                table: "player_type",
                keyColumn: "id",
                keyValue: 4,
                columns: new[] { "armor", "health" },
                values: new object[] { 15, 20 });
        }
    }
}
