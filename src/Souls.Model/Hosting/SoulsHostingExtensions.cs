using System.Security.Cryptography.X509Certificates;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.DataProtection.KeyManagement;
using Microsoft.AspNetCore.Diagnostics.HealthChecks;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Npgsql;
using OpenTelemetry.Metrics;
using OpenTelemetry.Trace;
using Souls.Model.Security;

namespace Souls.Model.Hosting;

public static class SoulsHostingExtensions
{
    /// <summary>Shared by the web app and game server so the server can read the web app's auth cookie.</summary>
    public const string ApplicationName = "Souls";

    /// <summary>
    /// Reads secrets from files, one setting per file (<c>ConnectionStrings__Souls</c>,
    /// <c>Souls__Admin__Password</c>, ...), as mounted by Docker secrets or Kubernetes secret volumes.
    /// The directory is <c>/run/secrets/souls</c> unless <c>SOULS_SECRETS_PATH</c> says otherwise.
    /// </summary>
    public static IConfigurationBuilder AddSoulsSecrets(this IConfigurationBuilder configuration)
    {
        var path = Environment.GetEnvironmentVariable("SOULS_SECRETS_PATH") ?? "/run/secrets/souls";
        return Directory.Exists(path) ? configuration.AddKeyPerFile(path, optional: true) : configuration;
    }

    /// <summary>Registers the PostgreSQL database, session/password services and a readiness health check.</summary>
    public static IServiceCollection AddSoulsDatabase(this IServiceCollection services)
    {
        services.AddDbContext<SoulsDbContext>((provider, options) =>
        {
            var connectionString = provider.GetRequiredService<IConfiguration>().GetConnectionString("Souls");
            if (string.IsNullOrWhiteSpace(connectionString))
            {
                throw new InvalidOperationException("Connection string 'ConnectionStrings:Souls' is not configured.");
            }

            // The distroless images ship without Kerberos; don't probe for GSS encryption unless asked to.
            var builder = new NpgsqlConnectionStringBuilder(connectionString);
            if (!connectionString.Contains("GSS Encryption", StringComparison.OrdinalIgnoreCase))
            {
                builder.GssEncryptionMode = GssEncryptionMode.Disable;
            }

            options.UseNpgsql(builder.ConnectionString, npgsql => npgsql.EnableRetryOnFailure(maxRetryCount: 5));
        });

        services.AddSingleton(TimeProvider.System);
        services.AddSingleton<PasswordService>();
        services.AddScoped<SessionService>();
        services.AddHealthChecks().AddDbContextCheck<SoulsDbContext>("database", tags: ["ready"]);
        return services;
    }

    /// <summary>
    /// Cookie authentication with the Data Protection key ring stored in the database, so every replica of the
    /// web app and the game server can issue and validate the same cookie. Each request re-validates the
    /// server-side session, so logouts and bans take effect immediately.
    /// The keys are encrypted at rest with the certificate in <c>Souls:DataProtection:Certificate</c> (a base64 PFX,
    /// mounted as a secret file); <c>Souls:DataProtection:PreviousCertificate</c> keeps keys written with an older
    /// certificate readable.
    /// </summary>
    public static AuthenticationBuilder AddSoulsAuthentication(this IServiceCollection services, IConfiguration configuration)
    {
        var dataProtection = services.AddDataProtection()
            .SetApplicationName(ApplicationName)
            .PersistKeysToDbContext<SoulsDbContext>();

        if (LoadCertificate(configuration, "Souls:DataProtection:Certificate") is { } certificate)
        {
            dataProtection.ProtectKeysWithCertificate(certificate);
        }

        if (LoadCertificate(configuration, "Souls:DataProtection:PreviousCertificate") is { } previous)
        {
            dataProtection.UnprotectKeysWithAnyCertificate(previous);
        }

        services.AddOptions<KeyManagementOptions>().PostConfigure<IHostEnvironment, ILoggerFactory>((options, environment, loggers) =>
        {
            if (options.XmlEncryptor is null && environment.IsProduction())
            {
                loggers.CreateLogger(typeof(SoulsHostingExtensions)).LogWarning(
                    "Data Protection keys are stored unencrypted in the database: anyone who can read it can forge login cookies. " +
                    "Set Souls:DataProtection:Certificate to a PFX certificate (base64) shared by the web app and the game server.");
            }
        });

        services.AddOptions<CookieAuthenticationOptions>(CookieAuthenticationDefaults.AuthenticationScheme)
            .Configure<IConfiguration, IHostEnvironment>((options, configuration, environment) =>
            {
                var secure = UseSecureCookies(configuration, environment);

                // The __Host- prefix makes browsers refuse the cookie unless it is Secure, host-only and Path=/.
                options.Cookie.Name = secure ? "__Host-souls" : "souls";
                options.Cookie.SecurePolicy = secure ? CookieSecurePolicy.Always : CookieSecurePolicy.SameAsRequest;
            });

        return services
            .AddAuthentication(CookieAuthenticationDefaults.AuthenticationScheme)
            .AddCookie(options =>
            {
                options.Cookie.HttpOnly = true;
                options.Cookie.SameSite = SameSiteMode.Lax;
                options.Cookie.Path = "/";
                options.ExpireTimeSpan = TimeSpan.FromHours(2);
                options.SlidingExpiration = true;
                options.LoginPath = "/Player/Login";
                options.LogoutPath = "/Player/Logout";
                options.AccessDeniedPath = "/Home/AccessDenied";
                options.Events.OnValidatePrincipal = async context =>
                {
                    var sessions = context.HttpContext.RequestServices.GetRequiredService<SessionService>();
                    if (await sessions.ValidateAsync(context.Principal, context.HttpContext.RequestAborted) is null)
                    {
                        context.RejectPrincipal();
                        await context.HttpContext.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
                    }
                };
            });
    }

    /// <summary>A base64 PFX from configuration, with its optional password in <c>{key}Password</c>.</summary>
    private static X509Certificate2? LoadCertificate(IConfiguration configuration, string key)
    {
        var pfx = configuration[key];
        return string.IsNullOrWhiteSpace(pfx) ? null : X509CertificateLoader.LoadPkcs12(Convert.FromBase64String(pfx), configuration[key + "Password"]);
    }

    /// <summary>
    /// Cookies are Secure (HTTPS only) unless running in Development or <c>Souls:SecureCookies</c> is false.
    /// </summary>
    public static bool UseSecureCookies(IConfiguration configuration, IHostEnvironment environment) =>
        configuration.GetValue("Souls:SecureCookies", !environment.IsDevelopment());

    /// <summary>
    /// Trust X-Forwarded-* only from the configured proxy networks (the ingress controller / Caddy).
    /// Configure with <c>Souls:TrustedProxyNetworks</c>, e.g. <c>10.0.0.0/8,172.16.0.0/12</c>.
    /// </summary>
    public static IServiceCollection AddSoulsForwardedHeaders(this IServiceCollection services, IConfiguration configuration)
    {
        var networks = configuration.GetValue<string>("Souls:TrustedProxyNetworks") ?? string.Empty;
        services.Configure<ForwardedHeadersOptions>(options =>
        {
            options.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto | ForwardedHeaders.XForwardedHost;
            options.ForwardLimit = 1;
            foreach (var network in networks.Split([',', ';', ' '], StringSplitOptions.RemoveEmptyEntries))
            {
                options.KnownIPNetworks.Add(System.Net.IPNetwork.Parse(network));
            }

            var hosts = configuration.GetValue<string>("Souls:AllowedForwardedHosts");
            if (!string.IsNullOrWhiteSpace(hosts))
            {
                options.AllowedHosts = hosts.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
            }
        });
        return services;
    }

    /// <summary>
    /// OpenTelemetry traces and metrics, exported with OTLP and configured by the standard <c>OTEL_*</c> environment
    /// variables (<c>OTEL_EXPORTER_OTLP_ENDPOINT</c>, <c>OTEL_SERVICE_NAME</c>, <c>OTEL_RESOURCE_ATTRIBUTES</c>, ...).
    /// Nothing is collected unless <c>OTEL_EXPORTER_OTLP_ENDPOINT</c> is set.
    /// </summary>
    public static IServiceCollection AddSoulsTelemetry(this IServiceCollection services, IConfiguration configuration)
    {
        if (string.IsNullOrWhiteSpace(configuration["OTEL_EXPORTER_OTLP_ENDPOINT"]))
        {
            return services;
        }

        services.AddOpenTelemetry()
            .WithTracing(tracing => tracing
                // Health probes would be most of the traces.
                .AddAspNetCoreInstrumentation(options => options.Filter = context => !context.Request.Path.StartsWithSegments("/healthz"))
                .AddHttpClientInstrumentation()
                .AddSource("Npgsql")
                .AddOtlpExporter())
            .WithMetrics(metrics => metrics
                .AddAspNetCoreInstrumentation()
                .AddHttpClientInstrumentation()
                // .NET runtime metrics (GC, thread pool, memory) and the apps' own meters (Souls.Server).
                .AddMeter("System.Runtime", "Souls.*")
                .AddOtlpExporter());
        return services;
    }

    /// <summary><c>/healthz/live</c> (process up) and <c>/healthz/ready</c> (database reachable).</summary>
    public static IEndpointRouteBuilder MapSoulsHealthChecks(this IEndpointRouteBuilder endpoints)
    {
        endpoints.MapHealthChecks("/healthz/live", new HealthCheckOptions { Predicate = _ => false }).DisableHttpMetrics();
        endpoints.MapHealthChecks("/healthz/ready", new HealthCheckOptions { Predicate = c => c.Tags.Contains("ready") }).DisableHttpMetrics();
        return endpoints;
    }
}
