var builder = WebApplication.CreateBuilder(args);

var app = builder.Build();

app.MapGet("/", () => new { service = "core-api", status = "running" });

app.Logger.LogInformation("core-api starting up, listening on port 8080");

app.Run();
