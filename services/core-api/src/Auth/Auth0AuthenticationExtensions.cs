using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Tokens;

namespace ExpenseTracker.CoreApi.Auth;

/// <summary>
/// Wires JwtBearer validation against Auth0's JWKS. Kept out of <c>Program.cs</c>
/// so the pipeline-composition file stays a short list of calls; the validation
/// rules themselves (claim mapping, clock skew, algorithm pinning) live here
/// alongside <see cref="Auth0Options"/>.
/// </summary>
public static class Auth0AuthenticationExtensions
{
    public static IServiceCollection AddAuth0Authentication(
        this IServiceCollection services, IConfiguration configuration)
    {
        // Fail at host build — before the server listens — when Auth0__Domain or
        // Auth0__Audience is missing or malformed, so the pod crash-loops naming
        // the setting (N1) instead of going green and 401ing every request.
        services.AddOptions<Auth0Options>()
            .Bind(configuration.GetSection(Auth0Options.SectionName))
            .ValidateDataAnnotations()
            .ValidateOnStart();

        services
            .AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
            .AddJwtBearer(options =>
            {
                var auth0 = configuration.GetSection(Auth0Options.SectionName).Get<Auth0Options>()
                    ?? new Auth0Options();

                // Trailing slash is required by the OIDC discovery convention;
                // Domain is a bare host with no scheme.
                options.Authority = $"https://{auth0.Domain}/";
                options.Audience = auth0.Audience;

                // Keep raw claim names: the default maps "sub" to a WS-Federation URI,
                // and User.FindFirst("sub") returns null for a perfectly valid token.
                // "sub" becomes Transaction.UserId in issue #4 — a mangled value there
                // is a data migration, not a code fix.
                options.MapInboundClaims = false;

                options.TokenValidationParameters = new TokenValidationParameters
                {
                    // The 5-minute default validates tokens expired 3 minutes ago,
                    // which makes the expired-token check read as broken validation.
                    ClockSkew = TimeSpan.FromSeconds(30),
                    // Explicit rather than relying on library defaults: an
                    // auditable guarantee against alg-confusion attacks, even
                    // though no symmetric key is configured here.
                    ValidAlgorithms = new[] { SecurityAlgorithms.RsaSha256 },
                };

                options.Events = new JwtBearerEvents
                {
                    OnAuthenticationFailed = context =>
                    {
                        // Log *why* a token was rejected so the four rejection cases
                        // are distinguishable. Hard rule: no token value is ever
                        // logged, in whole or in part.
                        var reason = context.Exception switch
                        {
                            SecurityTokenExpiredException => "token expired",
                            SecurityTokenInvalidAudienceException => "invalid audience",
                            SecurityTokenInvalidIssuerException => "invalid issuer",
                            SecurityTokenSignatureKeyNotFoundException => "signing key not found",
                            SecurityTokenInvalidSignatureException => "invalid signature",
                            SecurityTokenMalformedException => "malformed token",
                            SecurityTokenValidationException => "token validation failed",
                            _ => $"authentication failed ({context.Exception.GetType().Name})",
                        };
                        var logger = context.HttpContext.RequestServices
                            .GetRequiredService<ILoggerFactory>()
                            .CreateLogger("JwtBearer");
                        logger.LogWarning("JWT rejected: {Reason}", reason);
                        return Task.CompletedTask;
                    },
                };
            });

        return services;
    }

    /// <summary>
    /// Eagerly fetches OIDC discovery + JWKS rather than relying on the
    /// library's lazy-on-first-request default: a wrong tenant or unreachable
    /// Auth0 must fail the pod now, not produce a green pod that 401s
    /// everything. Bounded so an unresponsive tenant fails fast at startup
    /// rather than stalling pod readiness indefinitely.
    /// </summary>
    public static async Task<Auth0Options> WarmUpAuth0JwksAsync(this WebApplication app)
    {
        var resolvedAuth0 = app.Services.GetRequiredService<IOptions<Auth0Options>>().Value;

        var jwtOptions = app.Services
            .GetRequiredService<IOptionsMonitor<JwtBearerOptions>>()
            .Get(JwtBearerDefaults.AuthenticationScheme);
        if (jwtOptions.ConfigurationManager is null)
        {
            throw new InvalidOperationException(
                "JwtBearer ConfigurationManager was not initialized; cannot fetch JWKS eagerly.");
        }

        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(15));
        await jwtOptions.ConfigurationManager.GetConfigurationAsync(timeout.Token);

        return resolvedAuth0;
    }
}
