# Script de déploiement unifié (Docker + Nginx)
# Ce script copie la configuration et redéploie tout sur le port 3007

param(
    [string]$RemoteHost = "dyad1.ty-dev.site",
    [string]$RemoteUser = "root",
    [string]$RemotePath = "/root/dyad-1"
)

$ErrorActionPreference = "Stop"

Write-Host "╔════════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║  Déploiement Unifié Dyad + MCP (Port 3007)                 ║"
Write-Host "╚════════════════════════════════════════════════════════════╝" -ForegroundColor Cyan

# 1. Copier les fichiers de configuration mis à jour
Write-Host "[1/3] Mise à jour des configurations..." -ForegroundColor Yellow
scp C:\Users\amine\dyad-1\docker-compose.yml "${RemoteUser}@${RemoteHost}:${RemotePath}/"
scp C:\Users\amine\dyad-1\nginx.conf "${RemoteUser}@${RemoteHost}:${RemotePath}/"

# 2. Redémarrer sur le serveur distant
Write-Host "[2/3] Redémarrage des services Docker..." -ForegroundColor Yellow

$remoteScript = @"
cd $RemotePath
echo 'Arrêt des conteneurs...'
docker compose down

echo 'Nettoyage...'
docker rm -f dyad-nginx 2>/dev/null || true

echo 'Démarrage (Construction)...'
docker compose up -d --build

echo 'Vérification...'
sleep 5
docker compose ps
"@

ssh "${RemoteUser}@${RemoteHost}" $remoteScript

# 3. Test
Write-Host "[3/3] Tests de connexion..." -ForegroundColor Yellow
$baseUrl = "http://${RemoteHost}:3007"
Write-Host "  - Dyad Web: $baseUrl/"
Write-Host "  - MCP Health: $baseUrl/mcp/health"
Write-Host "  - MCP Apps: $baseUrl/mcp/api/apps"

try {
    Write-Host "Testing MCP Health..."
    $r = Invoke-WebRequest "$baseUrl/mcp/health" -UseBasicParsing -TimeoutSec 10
    Write-Host "✓ MCP Accessible via Nginx!" -ForegroundColor Green
    Write-Host $r.Content
} catch {
    Write-Host "⚠ Erreur test MCP: $($_.Exception.Message)" -ForegroundColor Red
}
