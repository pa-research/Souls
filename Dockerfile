# syntax=docker/dockerfile:1

# Builds both application images from one Dockerfile:
#   docker build --target web    -t souls-web .
#   docker build --target server -t souls-server .
#
# Behind a TLS-inspecting proxy, pass its CA bundle for the restore step:
#   docker build --secret id=ca-certificates,src=/path/to/ca-bundle.crt ...

ARG DOTNET_VERSION=10.0

FROM mcr.microsoft.com/dotnet/sdk:${DOTNET_VERSION}-noble AS build
WORKDIR /src

# Restore first so the package layer is cached until a project file changes.
# The packages stay in this layer, not in a cache mount: CI's layer cache does not carry
# cache mounts, so a cached restore layer would leave publish without its packages.
COPY global.json Directory.Build.props Directory.Packages.props ./
COPY src/Souls.Model/Souls.Model.csproj src/Souls.Model/
COPY src/Souls.Web/Souls.Web.csproj src/Souls.Web/
COPY src/Souls.Server/Souls.Server.csproj src/Souls.Server/
RUN --mount=type=secret,id=ca-certificates,target=/run/secrets/ca-certificates.crt,required=false \
    if [ -s /run/secrets/ca-certificates.crt ]; then export SSL_CERT_FILE=/run/secrets/ca-certificates.crt; fi; \
    dotnet restore src/Souls.Web/Souls.Web.csproj && \
    dotnet restore src/Souls.Server/Souls.Server.csproj

COPY src/ src/
RUN dotnet publish src/Souls.Web/Souls.Web.csproj -c Release -o /out/web --no-restore -p:UseAppHost=false && \
    dotnet publish src/Souls.Server/Souls.Server.csproj -c Release -o /out/server --no-restore -p:UseAppHost=false

# Chiseled ("distroless") Ubuntu image: no shell or package manager, runs as the non-root
# user "app" (UID 1654). The "extra" variant has ICU: the web site formats dates and numbers in
# the page's language (the game server uses invariant globalization and leaves it unused).
FROM mcr.microsoft.com/dotnet/aspnet:${DOTNET_VERSION}-noble-chiseled-extra AS runtime
WORKDIR /app
ENV ASPNETCORE_HTTP_PORTS=8080 \
    ASPNETCORE_ENVIRONMENT=Production \
    DOTNET_gcServer=0 \
    DOTNET_EnableDiagnostics=0
EXPOSE 8080
USER $APP_UID

FROM runtime AS web
LABEL org.opencontainers.image.title="souls-web" \
      org.opencontainers.image.description="Souls Online web site and game client" \
      org.opencontainers.image.source="https://github.com/pa-research/Souls"
COPY --from=build --chown=root:root /out/web .
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD ["dotnet", "Souls.Web.dll", "healthcheck"]
ENTRYPOINT ["dotnet", "Souls.Web.dll"]

FROM runtime AS server
LABEL org.opencontainers.image.title="souls-server" \
      org.opencontainers.image.description="Souls Online game server (WebSockets)" \
      org.opencontainers.image.source="https://github.com/pa-research/Souls"
COPY --from=build --chown=root:root /out/server .
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD ["dotnet", "Souls.Server.dll", "healthcheck"]
ENTRYPOINT ["dotnet", "Souls.Server.dll"]
