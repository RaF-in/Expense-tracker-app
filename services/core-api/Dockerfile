# Stage 1 — build. Keeps the .NET SDK off the host (ARCH A13).
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src

COPY core-api.csproj ./
RUN dotnet restore core-api.csproj

COPY src/ ./src/
RUN dotnet publish core-api.csproj -c Release -o /app/publish

# Stage 2 — runtime.
FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS runtime
WORKDIR /app

COPY --from=build /app/publish ./

EXPOSE 8080
ENTRYPOINT ["dotnet", "core-api.dll"]
