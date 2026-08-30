var builder = WebApplication.CreateBuilder(args);

var app = builder.Build();

app.MapGet("/", () => new { service = "ingestion-service", status = "running" });

app.Logger.LogInformation("ingestion-service starting up, listening on port 8080");

app.Run();
