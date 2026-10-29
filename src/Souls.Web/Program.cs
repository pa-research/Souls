using System.Threading.RateLimiting;
using Microsoft.AspNetCore.Antiforgery;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Authorization;
using Microsoft.AspNetCore.Mvc.ViewFeatures;
using Microsoft.EntityFrameworkCore;
using Souls.Model;
using Souls.Model.Hosting;
using Souls.Web.Services;

if (await SoulsCommands.TryRunHealthCheckAsync(args) is { } exitCode)
{
    return exitCode;
}

var builder = WebApplication.CreateBuilder(SoulsCommands.HostArgs(args));
builder.Configuration.AddSoulsSecrets();
if (SoulsCommands.IsMigrate(args))
{
    // EF Core logs an error while probing for the migrations table on an empty database.
    builder.Logging.AddFilter("Microsoft.EntityFrameworkCore.Database.Command", LogLevel.Critical);
}
builder.WebHost.ConfigureKestrel(kestrel =>
{
    kestrel.AddServerHeader = false;
    kestrel.Limits.MaxRequestBodySize = 2 * 1024 * 1024;
});

builder.Services.AddSoulsDatabase();
builder.Services.AddSoulsAuthentication();
builder.Services.AddSoulsForwardedHeaders(builder.Configuration);

builder.Services.AddAntiforgery(options =>
{
    options.Cookie.SameSite = SameSiteMode.Strict;
    options.HeaderName = "X-CSRF-TOKEN";
});
builder.Services.AddOptions<AntiforgeryOptions>().Configure<IConfiguration, IHostEnvironment>((options, configuration, environment) =>
{
    var secure = SoulsHostingExtensions.UseSecureCookies(configuration, environment);
    options.Cookie.Name = secure ? "__Host-souls-csrf" : "souls-csrf";
    options.Cookie.SecurePolicy = secure ? CookieSecurePolicy.Always : CookieSecurePolicy.SameAsRequest;
});

builder.Services.AddOptions<CookieTempDataProviderOptions>().Configure<IConfiguration, IHostEnvironment>((options, configuration, environment) =>
{
    var secure = SoulsHostingExtensions.UseSecureCookies(configuration, environment);
    options.Cookie.Name = secure ? "__Host-souls-tempdata" : "souls-tempdata";
    options.Cookie.SecurePolicy = secure ? CookieSecurePolicy.Always : CookieSecurePolicy.SameAsRequest;
    options.Cookie.SameSite = SameSiteMode.Lax;
});

builder.Services.AddControllersWithViews(options =>
{
    // Every page requires a login unless marked [AllowAnonymous]; every unsafe request needs an antiforgery token.
    options.Filters.Add(new AuthorizeFilter(new AuthorizationPolicyBuilder().RequireAuthenticatedUser().Build()));
    options.Filters.Add(new AutoValidateAntiforgeryTokenAttribute());
});

// Per client IP: login/registration attempts and image uploads. Limits are read from configuration
// (Souls:RateLimits:*) when a client is first seen.
builder.Services.AddRateLimiter(options =>
{
    options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    options.AddPolicy("auth", context => PerClient(context, "Souls:RateLimits:AuthPerMinute", 10));
    options.AddPolicy("upload", context => PerClient(context, "Souls:RateLimits:UploadsPerMinute", 20));

    static RateLimitPartition<string> PerClient(HttpContext context, string setting, int defaultLimit) =>
        RateLimitPartition.GetFixedWindowLimiter(context.Connection.RemoteIpAddress?.ToString() ?? "unknown", _ => new FixedWindowRateLimiterOptions
        {
            PermitLimit = context.RequestServices.GetRequiredService<IConfiguration>().GetValue(setting, defaultLimit),
            Window = TimeSpan.FromMinutes(1),
            QueueLimit = 0,
        });
});

builder.Services.AddHsts(options =>
{
    options.MaxAge = TimeSpan.FromDays(365);
    options.IncludeSubDomains = false;
});
builder.Services.AddHttpClient("status", client => client.Timeout = TimeSpan.FromSeconds(2));
builder.Services.AddSingleton<NewsSanitizer>();

var app = builder.Build();

if (SoulsCommands.IsMigrate(args))
{
    await SoulsCommands.RunMigrationsAsync(app);
    return 0;
}

app.UseForwardedHeaders();
if (!app.Environment.IsDevelopment())
{
    app.UseExceptionHandler("/Home/Error");
    app.UseHsts();
}

app.UseMiddleware<SecurityHeadersMiddleware>();
app.UseStatusCodePagesWithReExecute("/Home/Status/{0}");
app.UseRouting();
app.UseRateLimiter();
app.UseAuthentication();
app.UseAuthorization();

app.MapSoulsHealthChecks();
app.MapStaticAssets();

// Card portraits uploaded by administrators.
app.MapGet("/Images/Uploaded/{file}", async (string file, SoulsDbContext db, HttpContext context) =>
{
    if (!Guid.TryParseExact(Path.GetFileNameWithoutExtension(file), "N", out var id))
    {
        return Results.NotFound();
    }

    var image = await db.UploadedImages.AsNoTracking().SingleOrDefaultAsync(i => i.Id == id);
    if (image is null)
    {
        return Results.NotFound();
    }

    context.Response.Headers.CacheControl = "public, max-age=31536000, immutable";
    context.Response.Headers.ContentSecurityPolicy = "default-src 'none'; sandbox";
    return Results.File(image.Data, image.ContentType);
}).AllowAnonymous();

app.MapControllerRoute(name: "default", pattern: "{controller=Home}/{action=Index}/{id?}")
    .WithStaticAssets();

await app.RunAsync();
return 0;

