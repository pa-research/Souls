using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;

namespace Souls.Model;

/// <summary>Used by <c>dotnet ef migrations add</c>; no database connection is made.</summary>
public sealed class DesignTimeDbContextFactory : IDesignTimeDbContextFactory<SoulsDbContext>
{
    public SoulsDbContext CreateDbContext(string[] args) =>
        new(new DbContextOptionsBuilder<SoulsDbContext>()
            .UseNpgsql("Host=localhost;Database=souls;Username=souls")
            .Options);
}
