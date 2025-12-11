# Script PowerShell pour déployer le serveur MCP HTTP sur dyad1.ty-dev.site
# Exécuter depuis : C:\Users\amine\dyad-1

param(
    [string]$RemoteHost = "dyad1.ty-dev.site",
    [string]$RemoteUser = "root",
    [string]$RemotePath = "/root/dyad-1"
)

Write-Host ""
Write-Host "╔════════════════════════════════════════════════════════════╗" -ForegroundColor Blue
Write-Host "║  Déploiement MCP HTTP sur $RemoteHost" -ForegroundColor Blue
Write-Host "╚════════════════════════════════════════════════════════════╝" -ForegroundColor Blue
Write-Host ""

# Étape 1: Vérifier que les fichiers locaux existent
Write-Host "[1/7] Vérification des fichiers locaux..." -ForegroundColor Yellow
$LocalPath = "C:\Users\amine\dyad-1"

if (-not (Test-Path $LocalPath)) {
    Write-Host "✗ Le dossier $LocalPath n'existe pas" -ForegroundColor Red
    exit 1
}

if (-not (Test-Path "$LocalPath\mcp-server")) {
    Write-Host "✗ Le dossier mcp-server n'existe pas" -ForegroundColor Red
    exit 1
}

if (-not (Test-Path "$LocalPath\docker-compose.yml")) {
    Write-Host "✗ Le fichier docker-compose.yml n'existe pas" -ForegroundColor Red
    exit 1
}

Write-Host "✓ Fichiers locaux trouvés" -ForegroundColor Green

# Étape 2: Tester la connexion SSH
Write-Host ""
Write-Host "[2/7] Test de connexion SSH..." -ForegroundColor Yellow
$sshTest = ssh -o ConnectTimeout=5 "${RemoteUser}@${RemoteHost}" "echo 'SSH OK'" 2>&1

if ($LASTEXITCODE -ne 0) {
    Write-Host "✗ Impossible de se connecter via SSH" -ForegroundColor Red
    Write-Host "Erreur: $sshTest" -ForegroundColor Red
    exit 1
}

Write-Host "✓ Connexion SSH établie" -ForegroundColor Green

# Étape 3: Copier les fichiers avec SCP
Write-Host ""
Write-Host "[3/7] Copie des fichiers vers le serveur distant..." -ForegroundColor Yellow
Write-Host "Cela peut prendre quelques minutes..." -ForegroundColor Gray

# Créer le répertoire distant
ssh "${RemoteUser}@${RemoteHost}" "mkdir -p $RemotePath"

# Copier les fichiers essentiels
Write-Host "  - Copie de mcp-server..." -ForegroundColor Gray
scp -r "$LocalPath\mcp-server" "${RemoteUser}@${RemoteHost}:${RemotePath}/"

Write-Host "  - Copie de docker-compose.yml..." -ForegroundColor Gray
scp "$LocalPath\docker-compose.yml" "${RemoteUser}@${RemoteHost}:${RemotePath}/"

Write-Host "  - Copie de .env (si existe)..." -ForegroundColor Gray
if (Test-Path "$LocalPath\.env") {
    scp "$LocalPath\.env" "${RemoteUser}@${RemoteHost}:${RemotePath}/"
}

Write-Host "✓ Fichiers copiés" -ForegroundColor Green

# Étape 4: Installer les dépendances
Write-Host ""
Write-Host "[4/7] Installation des dépendances sur le serveur..." -ForegroundColor Yellow

$installScript = @"
cd $RemotePath/mcp-server
npm install
npm run build
ls -la dist/http-proxy.js
"@

ssh "${RemoteUser}@${RemoteHost}" $installScript

if ($LASTEXITCODE -ne 0) {
    Write-Host "✗ Erreur lors de l'installation" -ForegroundColor Red
    exit 1
}

Write-Host "✓ Dépendances installées et build effectué" -ForegroundColor Green

# Étape 5: Démarrer Docker
Write-Host ""
Write-Host "[5/7] Démarrage du conteneur Docker..." -ForegroundColor Yellow

$dockerScript = @"
cd $RemotePath
docker compose down
docker compose up -d --build mcp-server
sleep 5
docker compose ps
"@

ssh "${RemoteUser}@${RemoteHost}" $dockerScript

Write-Host "✓ Conteneur démarré" -ForegroundColor Green

# Étape 6: Ouvrir le firewall
Write-Host ""
Write-Host "[6/7] Ouverture du port 3008 dans le firewall..." -ForegroundColor Yellow

$firewallScript = @"
if command -v ufw &> /dev/null; then
    ufw allow 3008/tcp
    ufw status | grep 3008
elif command -v firewall-cmd &> /dev/null; then
    firewall-cmd --add-port=3008/tcp --permanent
    firewall-cmd --reload
else
    echo 'Aucun firewall détecté (ufw/firewalld)'
fi
"@

ssh "${RemoteUser}@${RemoteHost}" $firewallScript

Write-Host "✓ Firewall configuré" -ForegroundColor Green

# Étape 7: Vérifier le déploiement
Write-Host ""
Write-Host "[7/7] Vérification du déploiement..." -ForegroundColor Yellow

# Vérifier les logs
Write-Host "  - Logs du conteneur:" -ForegroundColor Gray
ssh "${RemoteUser}@${RemoteHost}" "docker logs dyad-mcp --tail 10"

# Tester localement sur le serveur
Write-Host ""
Write-Host "  - Test local (sur le serveur):" -ForegroundColor Gray
$localTest = ssh "${RemoteUser}@${RemoteHost}" "curl -f -m 5 http://localhost:3008/health 2>&1"
Write-Host $localTest

# Tester depuis l'extérieur
Write-Host ""
Write-Host "  - Test distant (depuis votre machine):" -ForegroundColor Gray
Start-Sleep -Seconds 2

try {
    $response = Invoke-WebRequest -Uri "http://${RemoteHost}:3008/health" -TimeoutSec 5 -UseBasicParsing
    Write-Host "✓ Serveur accessible depuis l'extérieur!" -ForegroundColor Green
    Write-Host $response.Content
} catch {
    Write-Host "⚠ Le serveur n'est pas encore accessible depuis l'extérieur" -ForegroundColor Yellow
    Write-Host "Cela peut prendre quelques secondes supplémentaires..." -ForegroundColor Gray
}

# Résumé
Write-Host ""
Write-Host "═══════════════════════════════════════════════════════════" -ForegroundColor Blue
Write-Host "✓ DÉPLOIEMENT TERMINÉ" -ForegroundColor Green
Write-Host "═══════════════════════════════════════════════════════════" -ForegroundColor Blue
Write-Host ""
Write-Host "Endpoints disponibles:" -ForegroundColor Cyan
Write-Host "  - Health:      http://${RemoteHost}:3008/health"
Write-Host "  - Apps API:    http://${RemoteHost}:3008/api/apps"
Write-Host "  - Chats API:   http://${RemoteHost}:3008/api/chats"
Write-Host ""
Write-Host "Pour tester:" -ForegroundColor Cyan
Write-Host "  curl http://${RemoteHost}:3008/health"
Write-Host "  curl http://${RemoteHost}:3008/api/apps"
Write-Host ""
Write-Host "Pour voir les logs:" -ForegroundColor Cyan
Write-Host "  ssh ${RemoteUser}@${RemoteHost} 'docker logs dyad-mcp -f'"
Write-Host ""
