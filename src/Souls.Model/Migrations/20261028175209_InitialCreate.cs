using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

#pragma warning disable CA1814 // Prefer jagged arrays over multidimensional

namespace Souls.Model.Migrations
{
    /// <inheritdoc />
    public partial class InitialCreate : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "ability",
                columns: table => new
                {
                    id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:IdentitySequenceOptions", "'1000', '1', '', '', 'False', '1'")
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    name = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false),
                    parameter = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ability", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "bot_names",
                columns: table => new
                {
                    id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:IdentitySequenceOptions", "'1000', '1', '', '', 'False', '1'")
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    name = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_bot_names", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "data_protection_keys",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    FriendlyName = table.Column<string>(type: "text", nullable: true),
                    Xml = table.Column<string>(type: "text", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_data_protection_keys", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "game_log_type",
                columns: table => new
                {
                    id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:IdentitySequenceOptions", "'1000', '1', '', '', 'False', '1'")
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    title = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false),
                    text = table.Column<string>(type: "text", nullable: false),
                    description = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_game_log_type", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "news",
                columns: table => new
                {
                    id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:IdentitySequenceOptions", "'1000', '1', '', '', 'False', '1'")
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    title = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false),
                    text = table.Column<string>(type: "text", nullable: false),
                    author = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false),
                    date = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    enabled = table.Column<bool>(type: "boolean", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_news", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "player_permission",
                columns: table => new
                {
                    id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:IdentitySequenceOptions", "'1000', '1', '', '', 'False', '1'")
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    name = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_player_permission", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "race",
                columns: table => new
                {
                    id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:IdentitySequenceOptions", "'1000', '1', '', '', 'False', '1'")
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    name = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false),
                    card_url = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_race", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "card",
                columns: table => new
                {
                    id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:IdentitySequenceOptions", "'1000', '1', '', '', 'False', '1'")
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    fk_ability = table.Column<int>(type: "integer", nullable: true),
                    fk_race = table.Column<int>(type: "integer", nullable: true),
                    name = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false),
                    attack = table.Column<int>(type: "integer", nullable: false),
                    health = table.Column<int>(type: "integer", nullable: false),
                    armor = table.Column<int>(type: "integer", nullable: false),
                    cost = table.Column<int>(type: "integer", nullable: false),
                    vendor_price = table.Column<int>(type: "integer", nullable: false),
                    level = table.Column<int>(type: "integer", nullable: false),
                    portrait = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_card", x => x.id);
                    table.ForeignKey(
                        name: "FK_card_ability_fk_ability",
                        column: x => x.fk_ability,
                        principalTable: "ability",
                        principalColumn: "id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "FK_card_race_fk_race",
                        column: x => x.fk_race,
                        principalTable: "race",
                        principalColumn: "id",
                        onDelete: ReferentialAction.SetNull);
                });

            migrationBuilder.CreateTable(
                name: "player_type",
                columns: table => new
                {
                    id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:IdentitySequenceOptions", "'1000', '1', '', '', 'False', '1'")
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    fk_ability = table.Column<int>(type: "integer", nullable: true),
                    fk_race = table.Column<int>(type: "integer", nullable: true),
                    name = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false),
                    attack = table.Column<int>(type: "integer", nullable: false),
                    armor = table.Column<int>(type: "integer", nullable: false),
                    health = table.Column<int>(type: "integer", nullable: false),
                    mana = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_player_type", x => x.id);
                    table.ForeignKey(
                        name: "FK_player_type_ability_fk_ability",
                        column: x => x.fk_ability,
                        principalTable: "ability",
                        principalColumn: "id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "FK_player_type_race_fk_race",
                        column: x => x.fk_race,
                        principalTable: "race",
                        principalColumn: "id",
                        onDelete: ReferentialAction.SetNull);
                });

            migrationBuilder.CreateTable(
                name: "player",
                columns: table => new
                {
                    id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:IdentitySequenceOptions", "'1000', '1', '', '', 'False', '1'")
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    fk_type = table.Column<int>(type: "integer", nullable: false),
                    name = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    normalized_name = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    password = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false),
                    money = table.Column<int>(type: "integer", nullable: false),
                    rank = table.Column<int>(type: "integer", nullable: false),
                    created = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    fk_permission = table.Column<int>(type: "integer", nullable: false),
                    is_system = table.Column<bool>(type: "boolean", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_player", x => x.id);
                    table.ForeignKey(
                        name: "FK_player_player_permission_fk_permission",
                        column: x => x.fk_permission,
                        principalTable: "player_permission",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_player_player_type_fk_type",
                        column: x => x.fk_type,
                        principalTable: "player_type",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "game",
                columns: table => new
                {
                    id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:IdentitySequenceOptions", "'1000', '1', '', '', 'False', '1'")
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    fk_player1 = table.Column<int>(type: "integer", nullable: false),
                    fk_player2 = table.Column<int>(type: "integer", nullable: false),
                    created = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_game", x => x.id);
                    table.ForeignKey(
                        name: "FK_game_player_fk_player1",
                        column: x => x.fk_player1,
                        principalTable: "player",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_game_player_fk_player2",
                        column: x => x.fk_player2,
                        principalTable: "player",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "player_bans",
                columns: table => new
                {
                    id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:IdentitySequenceOptions", "'1000', '1', '', '', 'False', '1'")
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    fk_player = table.Column<int>(type: "integer", nullable: false),
                    until = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_player_bans", x => x.id);
                    table.ForeignKey(
                        name: "FK_player_bans_player_fk_player",
                        column: x => x.fk_player,
                        principalTable: "player",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "player_cards",
                columns: table => new
                {
                    id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:IdentitySequenceOptions", "'1000', '1', '', '', 'False', '1'")
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    fk_player = table.Column<int>(type: "integer", nullable: false),
                    fk_card = table.Column<int>(type: "integer", nullable: false),
                    obtained_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_player_cards", x => x.id);
                    table.ForeignKey(
                        name: "FK_player_cards_card_fk_card",
                        column: x => x.fk_card,
                        principalTable: "card",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_player_cards_player_fk_player",
                        column: x => x.fk_player,
                        principalTable: "player",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "player_login",
                columns: table => new
                {
                    id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:IdentitySequenceOptions", "'1000', '1', '', '', 'False', '1'")
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    fk_player = table.Column<int>(type: "integer", nullable: false),
                    token_hash = table.Column<string>(type: "character(64)", fixedLength: true, maxLength: 64, nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    expires_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_player_login", x => x.id);
                    table.ForeignKey(
                        name: "FK_player_login_player_fk_player",
                        column: x => x.fk_player,
                        principalTable: "player",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "uploaded_image",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    content_type = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    data = table.Column<byte[]>(type: "bytea", nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    fk_uploaded_by = table.Column<int>(type: "integer", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_uploaded_image", x => x.id);
                    table.ForeignKey(
                        name: "FK_uploaded_image_player_fk_uploaded_by",
                        column: x => x.fk_uploaded_by,
                        principalTable: "player",
                        principalColumn: "id",
                        onDelete: ReferentialAction.SetNull);
                });

            migrationBuilder.CreateTable(
                name: "game_log",
                columns: table => new
                {
                    id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:IdentitySequenceOptions", "'1000', '1', '', '', 'False', '1'")
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    fk_log_type = table.Column<int>(type: "integer", nullable: false),
                    fk_game = table.Column<int>(type: "integer", nullable: false),
                    obj1_id = table.Column<int>(type: "integer", nullable: false),
                    obj2_id = table.Column<int>(type: "integer", nullable: false),
                    obj1_type = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    obj2_type = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_game_log", x => x.id);
                    table.ForeignKey(
                        name: "FK_game_log_game_fk_game",
                        column: x => x.fk_game,
                        principalTable: "game",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_game_log_game_log_type_fk_log_type",
                        column: x => x.fk_log_type,
                        principalTable: "game_log_type",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.InsertData(
                table: "ability",
                columns: new[] { "id", "name", "parameter" },
                values: new object[,]
                {
                    { 1, "Heal", null },
                    { 2, "Sacrifice", null }
                });

            migrationBuilder.InsertData(
                table: "bot_names",
                columns: new[] { "id", "name" },
                values: new object[,]
                {
                    { 1, "Hansel" },
                    { 2, "Satan" },
                    { 3, "Death" }
                });

            migrationBuilder.InsertData(
                table: "game_log_type",
                columns: new[] { "id", "description", "text", "title" },
                values: new object[,]
                {
                    { 1, "Player Won", "{0} wins against {1}", "WON" },
                    { 2, "Player defeat", "{0} loses against {1}", "DEFEAT" },
                    { 3, "Draw between players", "{0} plays a draw against {1}", "DRAW" },
                    { 4, "A card attacks a player (opponent)", "{0} attacks {1} for {2} damage.", "CARD_ATTACK_PLAYER" },
                    { 5, "A card attacks a card", "{0} attacks {1} for {2} damage.", "CARD_ATTACK_CARD" },
                    { 6, "A player attack the opponent", "{0} attacks {1} for {2} damage.", "PLAYER_ATTACK_PLAYER" },
                    { 7, "A player attack a card", "{0} attacks {1} for {2} damage.", "PLAYER_ATTACK_CARD" },
                    { 8, "A game was created where X player begins", "The battle begins, {0} starts the game against {1}", "GAME_CREATED" },
                    { 9, "A player uses a card", "{0} uses {1}", "USE_CARD" },
                    { 10, "a player initiates next turn", "{0} gives turn to {1}", "NEXT_TURN" },
                    { 11, "a player draws a new card", "{0} draws a card. The card was {1}", "NEW_CARD" },
                    { 12, "a player is kicked", "{0} was kicked from the game by [ADMIN]", "KICKED" },
                    { 13, "A card heals X", "{0} heals {1} for {2} hp", "ABILITY_HEAL" },
                    { 14, "A card sacrifices itself to X", "{0} sacrifices itself, strengthening {1} for {2}.", "ABILITY_SACRIFICE" }
                });

            migrationBuilder.InsertData(
                table: "player_permission",
                columns: new[] { "id", "name" },
                values: new object[,]
                {
                    { 1, "Admin" },
                    { 2, "Player" }
                });

            migrationBuilder.InsertData(
                table: "race",
                columns: new[] { "id", "card_url", "name" },
                values: new object[,]
                {
                    { 1, "/Content/Images/Card/Texture/darkness.png", "Darkness" },
                    { 2, "/Content/Images/Card/Texture/vampiric.png", "Vampiric" },
                    { 3, "/Content/Images/Card/Texture/lightbringer.png", "Lightbringer" },
                    { 4, "/Content/Images/Card/Texture/ferocious.png", "Ferocious" }
                });

            migrationBuilder.InsertData(
                table: "card",
                columns: new[] { "id", "fk_ability", "armor", "attack", "cost", "health", "level", "name", "portrait", "fk_race", "vendor_price" },
                values: new object[,]
                {
                    { 1, 1, 3, 5, 6, 7, 1, "Rhino", "/Content/Images/Card/Portraits/1.png", 4, 1 },
                    { 2, 2, 1, 1, 2, 1, 1, "Zebra", "/Content/Images/Card/Portraits/2.png", 3, 1 },
                    { 3, 2, 1, 6, 4, 4, 1, "Per", "/Content/Images/Card/Portraits/3.png", 4, 1 },
                    { 4, 1, 2, 5, 4, 5, 2, "Christine", "/Content/Images/Card/Portraits/4.png", 1, 3 },
                    { 5, 1, 2, 3, 5, 6, 1, "Anette", "/Content/Images/Card/Portraits/5.png", 4, 1 },
                    { 6, 2, 1, 2, 1, 3, 1, "Bobby", "/Content/Images/Card/Portraits/6.png", 2, 1 }
                });

            migrationBuilder.InsertData(
                table: "player_type",
                columns: new[] { "id", "fk_ability", "armor", "attack", "health", "mana", "name", "fk_race" },
                values: new object[,]
                {
                    { 1, 1, 2, 5, 20, 0, "Rabid Soul", 1 },
                    { 2, 2, 4, 2, 35, 1, "Lurker", 2 },
                    { 3, 1, 0, 10, 10, 0, "Harrison", 3 },
                    { 4, 2, 15, 1, 20, 2, "Fader", 4 }
                });

            migrationBuilder.CreateIndex(
                name: "IX_card_fk_ability",
                table: "card",
                column: "fk_ability");

            migrationBuilder.CreateIndex(
                name: "IX_card_fk_race",
                table: "card",
                column: "fk_race");

            migrationBuilder.CreateIndex(
                name: "IX_game_fk_player1",
                table: "game",
                column: "fk_player1");

            migrationBuilder.CreateIndex(
                name: "IX_game_fk_player2",
                table: "game",
                column: "fk_player2");

            migrationBuilder.CreateIndex(
                name: "IX_game_log_fk_game",
                table: "game_log",
                column: "fk_game");

            migrationBuilder.CreateIndex(
                name: "IX_game_log_fk_log_type",
                table: "game_log",
                column: "fk_log_type");

            migrationBuilder.CreateIndex(
                name: "IX_player_fk_permission",
                table: "player",
                column: "fk_permission");

            migrationBuilder.CreateIndex(
                name: "IX_player_fk_type",
                table: "player",
                column: "fk_type");

            migrationBuilder.CreateIndex(
                name: "IX_player_name",
                table: "player",
                column: "name",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_player_normalized_name",
                table: "player",
                column: "normalized_name",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_player_bans_fk_player",
                table: "player_bans",
                column: "fk_player");

            migrationBuilder.CreateIndex(
                name: "IX_player_cards_fk_card",
                table: "player_cards",
                column: "fk_card");

            migrationBuilder.CreateIndex(
                name: "IX_player_cards_fk_player_fk_card",
                table: "player_cards",
                columns: new[] { "fk_player", "fk_card" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_player_login_fk_player",
                table: "player_login",
                column: "fk_player",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_player_login_token_hash",
                table: "player_login",
                column: "token_hash",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_player_type_fk_ability",
                table: "player_type",
                column: "fk_ability");

            migrationBuilder.CreateIndex(
                name: "IX_player_type_fk_race",
                table: "player_type",
                column: "fk_race");

            migrationBuilder.CreateIndex(
                name: "IX_uploaded_image_fk_uploaded_by",
                table: "uploaded_image",
                column: "fk_uploaded_by");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "bot_names");

            migrationBuilder.DropTable(
                name: "data_protection_keys");

            migrationBuilder.DropTable(
                name: "game_log");

            migrationBuilder.DropTable(
                name: "news");

            migrationBuilder.DropTable(
                name: "player_bans");

            migrationBuilder.DropTable(
                name: "player_cards");

            migrationBuilder.DropTable(
                name: "player_login");

            migrationBuilder.DropTable(
                name: "uploaded_image");

            migrationBuilder.DropTable(
                name: "game");

            migrationBuilder.DropTable(
                name: "game_log_type");

            migrationBuilder.DropTable(
                name: "card");

            migrationBuilder.DropTable(
                name: "player");

            migrationBuilder.DropTable(
                name: "player_permission");

            migrationBuilder.DropTable(
                name: "player_type");

            migrationBuilder.DropTable(
                name: "ability");

            migrationBuilder.DropTable(
                name: "race");
        }
    }
}
