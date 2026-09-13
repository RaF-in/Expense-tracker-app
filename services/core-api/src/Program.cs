using System.Security.Claims;
using ExpenseTracker.CoreApi.Auth;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Authorization;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Tokens;

var builder = WebApplication.CreateBuilder(args);

const string CorsPolicy = "FrontendOrigins";

builder.Services.AddCors(options =>
{
    options.AddPolicy(CorsPolicy, policy =>
    {
        // AllowAnyHeader() is deliberate: it is what permits the Authorization
        // header. "Tidying" this to an explicit list that omits Authorization
        // breaks every Vite-dev API call while the ingress path (same-origin)
        // keeps working — a dev-only failure that looks like a working app.
        policy.WithOrigins("http://localhost", "http://localhost:5173")
            .AllowAnyHeader()
            .AllowAnyMethod();
    });
});

// Fail at host build — before the server listens — when Auth0__Domain or
// Auth0__Audience is missing or malformed, so the pod crash-loops naming the
// setting (N1) instead of going green and 401ing every request.
builder.Services.AddOptions<Auth0Options>()
    .Bind(builder.Configuration.GetSection(Auth0Options.SectionName))
    .ValidateDataAnnotations()
    .ValidateOnStart();

builder.Services
    .AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(options =>
    {
        var auth0 = builder.Configuration.GetSection(Auth0Options.SectionName).Get<Auth0Options>()
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

// Protected by default: every endpoint requires an authenticated user unless
// it explicitly opts out with .AllowAnonymous(). A forgotten future endpoint
// 401s instead of shipping public. `grep AllowAnonymous` in this file is the
// complete, auditable answer to "what is public?".
builder.Services.AddAuthorization(options =>
{
    options.FallbackPolicy = new AuthorizationPolicyBuilder()
        .RequireAuthenticatedUser()
        .Build();
});

var app = builder.Build();

// Force options validation here rather than relying on ValidateOnStart alone:
// startup validation runs at host start, which is *after* the JWKS fetch below,
// and a missing setting must fail naming itself — not as a malformed Authority
// ("https:///") three steps later.
var resolvedAuth0 = app.Services.GetRequiredService<IOptions<Auth0Options>>().Value;

// Eagerly fetch OIDC discovery + JWKS at startup rather than lazily on the
// first request: a wrong tenant or unreachable Auth0 must fail the pod now —
// the lazy default produces a green pod that 401s everything. Validation is
// then a local RSA signature check for the process lifetime; Auth0 being
// unreachable later has zero impact.
var jwtOptions = app.Services
    .GetRequiredService<IOptionsMonitor<JwtBearerOptions>>()
    .Get(JwtBearerDefaults.AuthenticationScheme);
if (jwtOptions.ConfigurationManager is null)
{
    throw new InvalidOperationException(
        "JwtBearer ConfigurationManager was not initialized; cannot fetch JWKS eagerly.");
}
await jwtOptions.ConfigurationManager.GetConfigurationAsync(CancellationToken.None);
app.Logger.LogInformation(
    "core-api Auth0 ready — domain: {Domain}, audience: {Audience}, JWKS fetched",
    resolvedAuth0.Domain, resolvedAuth0.Audience);

// UseCors must stay ahead of UseAuthentication/UseAuthorization: a CORS
// preflight carries no Authorization header, and the fallback policy would
// 401 it — breaking every Vite-dev API call while the ingress path works.
// This passes every check made through http://localhost and fails only on
// http://localhost:5173, so verify the preflight explicitly.
app.UseCors(CorsPolicy);
app.UseAuthentication();
app.UseAuthorization();

app.MapGet("/", () => new { service = "core-api", status = "running" })
    .AllowAnonymous();

app.MapGet("/api/health", () => new
{
    status = "ok",
    timestamp = DateTime.UtcNow.ToString("o"),
    version = "0.1.0",
})
    .AllowAnonymous();

// Claims are read null-safely: machine tokens (issue #5) legitimately carry
// none of the profile claims. The namespaced claim URIs are set verbatim by
// the tenant's Post-Login Action — access tokens carry no standard email/name.
app.MapGet("/api/me", (ClaimsPrincipal user) => new
{
    sub = user.FindFirst("sub")?.Value,
    email = user.FindFirst("https://expense-tracker.local/email")?.Value,
    name = user.FindFirst("https://expense-tracker.local/name")?.Value,
});

app.Logger.LogInformation("core-api starting up, listening on port 8080");

app.Run();
