var builder = WebApplication.CreateBuilder(args);

const string CorsPolicy = "FrontendOrigins";

builder.Services.AddCors(options =>
{
    options.AddPolicy(CorsPolicy, policy =>
    {
        policy.WithOrigins("http://localhost", "http://localhost:5173")
            .AllowAnyHeader()
            .AllowAnyMethod();
    });
});

var app = builder.Build();

app.UseCors(CorsPolicy);

app.MapGet("/", () => new { service = "core-api", status = "running" });

app.MapGet("/api/health", () => new
{
    status = "ok",
    timestamp = DateTime.UtcNow.ToString("o"),
    version = "0.1.0",
});

app.Logger.LogInformation("core-api starting up, listening on port 8080");

app.Run();
