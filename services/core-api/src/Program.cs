using System.Security.Claims;
using ExpenseTracker.CoreApi.Auth;
using Microsoft.AspNetCore.Authorization;

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

// Auth0/JWT bearer wiring lives in Auth/Auth0AuthenticationExtensions.cs —
// claim mapping, clock skew, and algorithm pinning are validation rules, not
// pipeline composition, so they belong next to Auth0Options rather than here.
builder.Services.AddAuth0Authentication(builder.Configuration);

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

// Eagerly fetch OIDC discovery + JWKS at startup rather than lazily on the
// first request: a wrong tenant or unreachable Auth0 must fail the pod now —
// the lazy default produces a green pod that 401s everything. Validation is
// then a local RSA signature check for the process lifetime; Auth0 being
// unreachable later has zero impact. Bounded by a 15s timeout so a slow or
// hanging tenant fails fast instead of stalling pod readiness indefinitely.
var resolvedAuth0 = await app.WarmUpAuth0JwksAsync();
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
