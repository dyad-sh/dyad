#!/usr/bin/env pwsh
# =============================================================================
# Script PowerShell : Démarrage de Dyad en mode production
# Usage: .\start-prod.ps1
# =============================================================================

Write-Host "🚀 Démarrage de l'environnement de production Dyad..." -ForegroundColor Cyan
Write-Host ""

# Vérifier que Docker est installé
Write-Host "🔍 Vérification de Docker..." -ForegroundColor Yellow
try {
    $dockerVersion = docker --version
    Write-Host "✅ Docker trouvé: $dockerVersion" -ForegroundColor Green
} catch {
    Write-Host "❌ Docker n'est pas installé ou n'est pas en cours d'exécution" -ForegroundColor Red
    exit 1
}

# Vérifier que le fichier .env existe
if (-Not (Test-Path ".env")) {
    Write-Host "⚠️  Fichier .env non trouvé" -ForegroundColor Yellow
    Write-Host "   Création d'un fichier .env à partir de .env.example..." -ForegroundColor Yellow
    
    if (Test-Path ".env.example") {
        Copy-Item ".env.example" ".env"
        Write-Host "✅ Fichier .env créé. Veuillez le configurer avec vos clés API." -ForegroundColor Green
        Write-Host "   Éditez le fichier .env avant de relancer ce script." -ForegroundColor Yellow
        exit 0
    } else {
        Write-Host "❌ .env.example non trouvé. Impossible de créer .env" -ForegroundColor Red
        exit 1
    }
}

Write-Host ""
Write-Host "🏗️  Build de l'image de production..." -ForegroundColor Yellow
Write-Host "   ⚠️  Cela peut prendre plusieurs minutes la première fois..." -ForegroundColor Yellow
Write-Host ""

# Build et démarrer en production
docker-compose -f docker-compose.prod.yml up --build -d

if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "✅ Services de production démarrés!" -ForegroundColor Green
    Write-Host ""
    Write-Host "╔════════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
    Write-Host "║              Dyad - Mode Production                       ║" -ForegroundColor Cyan
    Write-Host "╚════════════════════════════════════════════════════════════╝" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "  🌐 Application:  http://localhost:3007" -ForegroundColor White
    Write-Host "  🔌 API:          http://localhost:3007/api" -ForegroundColor White
    Write-Host "  📡 MCP Server:   http://localhost:3008" -ForegroundColor White
    Write-Host ""
    Write-Host "  📊 Health Check:  http://localhost:3007/api/health" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "  📋 Commandes utiles:" -ForegroundColor Yellow
    Write-Host "     Voir les logs:         docker-compose -f docker-compose.prod.yml logs -f" -ForegroundColor Gray
    Write-Host "     Arrêter:               docker-compose -f docker-compose.prod.yml down" -ForegroundColor Gray
    Write-Host "     Redémarrer:            docker-compose -f docker-compose.prod.yml restart" -ForegroundColor Gray
    Write-Host ""
    
    # Attendre que les services soient prêts
    Write-Host "⏳ Attente du démarrage complet (peut prendre jusqu'à 40s)..." -ForegroundColor Yellow
    Start-Sleep -Seconds 10
    
    Write-Host ""
    Write-Host "🎉 Production prête!" -ForegroundColor Green
    Write-Host ""
} else {
    Write-Host ""
    Write-Host "❌ Erreur lors du build/démarrage" -ForegroundColor Red
    Write-Host "   Consultez les logs avec: docker-compose -f docker-compose.prod.yml logs" -ForegroundColor Red
    exit 1
}
