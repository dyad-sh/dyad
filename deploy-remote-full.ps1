# Script de déploiement COMPLET pour Dyad (Web + Server + MCP)
# Déploie la version "Web Compatible" sur dyad1.ty-dev.site

param(
    [string]$RemoteHost = "dyad1.ty-dev.site",
    [string]$RemoteUser = "root",
    [string]$RemotePath = "/root/dyad-1"
)

$ErrorActionPreference = "Stop"

Write-Host "╔════════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║  DÉPLOIEMENT COMPLET DYAD (WEB + BACKEND)                  ║"
Write-Host "║  Cible: $RemoteHost                                     ║"
Write-Host "╚════════════════════════════════════════════════════════════╝" -ForegroundColor Cyan

# 1. Création de l'archive locale
Write-Host "`n[1/4] Création de l'archive de déploiement..." -ForegroundColor Yellow
$excludeList = @(
    "node_modules", 
    ".git", 
    "dist", 
    "out", 
    ".env", 
    "deploy-package.tar.gz",
    "*.log",
    "dyad-data",
    ".cache"
)

# Utilisation de tar pour exclure proprement et compresser
# Note: On suppose que 'tar' est disponible dans le terminal (Windows 10+ le supporte nativement via cmd/powershell)
try {
    # On supprime l'ancienne archive si elle existe
    if (Test-Path "deploy-package.tar.gz") { Remove-Item "deploy-package.tar.gz" }
    
    # Création de l'archive
    # On inclut explicitement les dossiers nécessaires pour le build Docker
    tar --exclude-vcs --exclude='node_modules' --exclude='dist' --exclude='.env' --exclude='dyad-data' -czf deploy-package.tar.gz .
    
    Write-Host "✓ Archive créée: deploy-package.tar.gz" -ForegroundColor Green
} catch {
    Write-Host "✗ Erreur lors de la création de l'archive: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

# 2. Transfert
Write-Host "`n[2/4] Transfert vers le serveur..." -ForegroundColor Yellow
try {
    # Créer le dossier distant
    ssh "${RemoteUser}@${RemoteHost}" "mkdir -p $RemotePath"
    
    # Upload de l'archive
    scp "deploy-package.tar.gz" "${RemoteUser}@${RemoteHost}:${RemotePath}/"
    
    # Upload des fichiers de config spécifiques si nécessaire (ex: .env production manuel, ou on laisse celui sur le serveur)
    # scp ".env.production" "${RemoteUser}@${RemoteHost}:${RemotePath}/.env"
    
    Write-Host "✓ Transfert terminé" -ForegroundColor Green
} catch {
    Write-Host "✗ Erreur de transfert: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

# 3. Déploiement distant
Write-Host "`n[3/4] Installation et Démarrage distant..." -ForegroundColor Yellow

$remoteScript = @"
cd $RemotePath

echo '[Remote] Extraction de l archive...'
tar -xzf deploy-package.tar.gz --overwrite

echo '[Remote] Arrêt des services existants...'
docker compose down

echo '[Remote] Re-Construction des images (Web + MCP)...'
# On force le build pour inclure les changements de code (IPC Refactor)
docker compose build

echo '[Remote] Démarrage des services...'
docker compose up -d

echo '[Remote] Nettoyage...'
rm deploy-package.tar.gz
docker system prune -f --filter "until=24h" # Nettoyage léger

echo '[Remote] Vérification...'
sleep 5
docker compose ps
"@

try {
    ssh "${RemoteUser}@${RemoteHost}" $remoteScript
    Write-Host "✓ Commandes distantes exécutées" -ForegroundColor Green
} catch {
    Write-Host "✗ Erreur lors de l'exécution distante: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

# 4. Vérification finale
Write-Host "`n[4/4] Vérification de santé..." -ForegroundColor Yellow
$baseUrl = "http://${RemoteHost}:3007" # Ou port défini dans docker-compose/nginx

try {
    Start-Sleep -Seconds 5
    $respApp = Invoke-WebRequest "$baseUrl/api/health" -Method Get -UseBasicParsing -TimeoutSec 5
    Write-Host "✓ Dyad API accessible: $($respApp.StatusCode)" -ForegroundColor Green
} catch {
    Write-Host "⚠ Dyad API non accessible immédiatement (peut encore être en démarrage)" -ForegroundColor Yellow
}

Write-Host "`nDÉPLOIEMENT TERMINÉ AVEC SUCCÈS 🚀" -ForegroundColor Cyan
