using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Souls.Model.Migrations
{
    /// <inheritdoc />
    public partial class RestoreHuyCard : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.UpdateData(
                table: "card",
                keyColumn: "id",
                keyValue: 5,
                column: "name",
                value: "Huy");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.UpdateData(
                table: "card",
                keyColumn: "id",
                keyValue: 5,
                column: "name",
                value: "Anette");
        }
    }
}
