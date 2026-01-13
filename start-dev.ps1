#!/usr/bin/env pwsh
# =============================================================================
# Script PowerShell : Démarrage de Dyad en mode développement
# Usage: .\start-dev.ps1
# =============================================================================

Write-Host "🚀 Démarrage de l'environnement de développement Dyad..." -ForegroundColor Cyan
Write-Host ""

# Vérifier que Docker est installé et en cours d'exécution
Write-Host "🔍 Vérification de Docker..." -ForegroundColor Yellow
try {
    $dockerVersion = docker --version
    Write-Host "✅ Docker trouvé: $dockerVersion" -ForegroundColor Green
} catch {
    Write-Host "❌ Docker n'est pas installé ou n'est pas en cours d'exécution" -ForegroundColor Red
    Write-Host "   Veuillez installer Docker Desktop depuis https://www.docker.com/products/docker-desktop" -ForegroundColor Red
    exit 1
}

# Vérifier que docker-compose est disponible
try {
    $composeVersion = docker-compose --version
    Write-Host "✅ Docker Compose trouvé: $composeVersion" -ForegroundColor Green
} catch {
    Write-Host "❌ Docker Compose n'est pas disponible" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "🏗️  Construction et démarrage des services..." -ForegroundColor Yellow
Write-Host ""

# Démarrer les services avec docker-compose
docker-compose -f docker-compose.dev.yml up --build -d

if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "✅ Tous les services sont démarrés!" -ForegroundColor Green
    Write-Host ""
    Write-Host "╔════════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
    Write-Host "║           Dyad - Environnement de développement           ║" -ForegroundColor Cyan
    Write-Host "╚════════════════════════════════════════════════════════════╝" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "  🌐 Frontend:     http://localhost:5173" -ForegroundColor White
    Write-Host "  🔌 Backend API:  http://localhost:3007" -ForegroundColor White
    Write-Host "  📡 MCP Server:   http://localhost:3008" -ForegroundColor White
    Write-Host ""
    Write-Host "  📊 Health Checks:" -ForegroundColor Yellow
    Write-Host "     Backend:      http://localhost:3007/api/health" -ForegroundColor Gray
    Write-Host "     MCP Server:   http://localhost:3008/health" -ForegroundColor Gray
    Write-Host ""
    Write-Host "  📋 Commandes utiles:" -ForegroundColor Yellow
    Write-Host "     Voir les logs:         docker-compose -f docker-compose.dev.yml logs -f" -ForegroundColor Gray
    Write-Host "     Arrêter les services:  docker-compose -f docker-compose.dev.yml down" -ForegroundColor Gray
    Write-Host "     Redémarrer:            docker-compose -f docker-compose.dev.yml restart" -ForegroundColor Gray
    Write-Host ""
    
    # Attendre que les services soient prêts
    Write-Host "⏳ Attente du démarrage des services..." -ForegroundColor Yellow
    Start-Sleep -Seconds 5
    
    # Vérifier la santé des services
    Write-Host ""
    Write-Host "🏥 Vérification de la santé des services..." -ForegroundColor Yellow
    
    try {
        $backendHealth = Invoke-RestMethod -Uri "http://localhost:3007/api/health" -TimeoutSec 5
        Write-Host "  ✅ Backend: OK" -ForegroundColor Green
    } catch {
        Write-Host "  ⚠️  Backend: En cours de démarrage..." -ForegroundColor Yellow
    }
    
    try {
        $mcpHealth = Invoke-RestMethod -Uri "http://localhost:3008/health" -TimeoutSec 5
        Write-Host "  ✅ MCP Server: OK" -ForegroundColor Green
    } catch {
        Write-Host "  ⚠️  MCP Server: En cours de démarrage..." -ForegroundColor Yellow
    }
    
    Write-Host ""
    Write-Host "🎉 Prêt à développer! Ouvrez http://localhost:5173 dans votre navigateur" -ForegroundColor Green
    Write-Host ""
} else {
    Write-Host ""
    Write-Host "❌ Erreur lors du démarrage des services" -ForegroundColor Red
    Write-Host "   Consultez les logs avec: docker-compose -f docker-compose.dev.yml logs" -ForegroundColor Red
    exit 1
}
