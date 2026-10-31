using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Souls.Model.Migrations
{
    /// <summary>
    /// The painted portraits replace the 2014 built-in files (moved to Portraits/original-2014): the seeded cards get
    /// their new names, and so does any other card (made in the admin editor) that used an old built-in name.
    /// Uploaded portraits (other paths) are left alone.
    /// </summary>
    public partial class PaintedPortraits : Migration
    {
        private const string Dir = "/Content/Images/Card/Portraits/";

        /// <summary>Old built-in portrait file -> the painted file that replaces it.</summary>
        public static readonly IReadOnlyList<(string From, string To)> Renamed =
        [
            ("0.png", "0.jpg"), ("1.png", "1.jpg"), ("2.png", "2.jpg"), ("3.png", "3.jpg"), ("4.png", "4.jpg"),
            ("5.png", "5.jpg"), ("6.png", "6.jpg"), ("18.png", "18.jpg"),
            ("15.png", "5.jpg"),                     // a copy of the 2014 5.png
            ("15.gif", "0.jpg"), ("6.gif", "0.jpg"), // a 2014 animation with no painting: the unknown card's
        ];

        /// <summary>SQL that sets every card's portrait from <paramref name="pairs"/> (file names) to the new name.</summary>
        public static string RewriteSql(IEnumerable<(string From, string To)> pairs)
        {
            var list = pairs.ToList();
            var cases = string.Join(" ", list.Select(p => $"WHEN '{Dir}{p.From}' THEN '{Dir}{p.To}'"));
            var from = string.Join(", ", list.Select(p => $"'{Dir}{p.From}'"));
            return $"UPDATE card SET portrait = CASE portrait {cases} END WHERE portrait IN ({from});";
        }

        /// <summary>Down only undoes the plain renames (N.png -> N.jpg); the merged ones cannot be told apart.</summary>
        public static IEnumerable<(string From, string To)> Reverted =>
            Renamed.Where(p => p.To == Path.ChangeExtension(p.From, ".jpg")).Select(p => (p.To, p.From));

        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(RewriteSql(Renamed));

            migrationBuilder.UpdateData(
                table: "card",
                keyColumn: "id",
                keyValue: 1,
                column: "portrait",
                value: "/Content/Images/Card/Portraits/1.jpg");

            migrationBuilder.UpdateData(
                table: "card",
                keyColumn: "id",
                keyValue: 2,
                column: "portrait",
                value: "/Content/Images/Card/Portraits/2.jpg");

            migrationBuilder.UpdateData(
                table: "card",
                keyColumn: "id",
                keyValue: 3,
                column: "portrait",
                value: "/Content/Images/Card/Portraits/3.jpg");

            migrationBuilder.UpdateData(
                table: "card",
                keyColumn: "id",
                keyValue: 4,
                column: "portrait",
                value: "/Content/Images/Card/Portraits/4.jpg");

            migrationBuilder.UpdateData(
                table: "card",
                keyColumn: "id",
                keyValue: 5,
                column: "portrait",
                value: "/Content/Images/Card/Portraits/5.jpg");

            migrationBuilder.UpdateData(
                table: "card",
                keyColumn: "id",
                keyValue: 6,
                column: "portrait",
                value: "/Content/Images/Card/Portraits/6.jpg");

            migrationBuilder.UpdateData(
                table: "card",
                keyColumn: "id",
                keyValue: 18,
                column: "portrait",
                value: "/Content/Images/Card/Portraits/18.jpg");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(RewriteSql(Reverted));

            migrationBuilder.UpdateData(
                table: "card",
                keyColumn: "id",
                keyValue: 1,
                column: "portrait",
                value: "/Content/Images/Card/Portraits/1.png");

            migrationBuilder.UpdateData(
                table: "card",
                keyColumn: "id",
                keyValue: 2,
                column: "portrait",
                value: "/Content/Images/Card/Portraits/2.png");

            migrationBuilder.UpdateData(
                table: "card",
                keyColumn: "id",
                keyValue: 3,
                column: "portrait",
                value: "/Content/Images/Card/Portraits/3.png");

            migrationBuilder.UpdateData(
                table: "card",
                keyColumn: "id",
                keyValue: 4,
                column: "portrait",
                value: "/Content/Images/Card/Portraits/4.png");

            migrationBuilder.UpdateData(
                table: "card",
                keyColumn: "id",
                keyValue: 5,
                column: "portrait",
                value: "/Content/Images/Card/Portraits/5.png");

            migrationBuilder.UpdateData(
                table: "card",
                keyColumn: "id",
                keyValue: 6,
                column: "portrait",
                value: "/Content/Images/Card/Portraits/6.png");

            migrationBuilder.UpdateData(
                table: "card",
                keyColumn: "id",
                keyValue: 18,
                column: "portrait",
                value: "/Content/Images/Card/Portraits/18.png");
        }
    }
}
