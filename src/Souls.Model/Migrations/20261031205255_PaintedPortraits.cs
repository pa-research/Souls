using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Souls.Model.Migrations
{
    /// <inheritdoc />
    public partial class PaintedPortraits : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
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
