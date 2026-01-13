#!/usr/bin/env pwsh
# =============================================================================
# Script PowerShell : Arrêt de tous les services Dyad
# Usage: .\stop-all.ps1
# =============================================================================

Write-Host "🛑 Arrêt de tous les services Dyad..." -ForegroundColor Yellow
Write-Host ""

# Arrêter dev
if (Test-Path "docker-compose.dev.yml") {
    Write-Host "  Arrêt de l'environnement de développement..." -ForegroundColor Gray
    docker-compose -f docker-compose.dev.yml down
}

# Arrêter prod
if (Test-Path "docker-compose.prod.yml") {
    Write-Host "  Arrêt de l'environnement de production..." -ForegroundColor Gray
    docker-compose -f docker-compose.prod.yml down
}

# Arrêter le compose Coolify si présent
if (Test-Path "docker-compose.yml") {
    Write-Host "  Arrêt du service Coolify..." -ForegroundColor Gray
    docker-compose -f docker-compose.yml down 2>$null
}

Write-Host ""
Write-Host "✅ Tous les services ont été arrêtés" -ForegroundColor Green
Write-Host ""
Write-Host "💡 Pour supprimer également les volumes (données), utilisez:" -ForegroundColor Yellow
Write-Host "   docker-compose -f docker-compose.dev.yml down -v" -ForegroundColor Gray
Write-Host "   docker-compose -f docker-compose.prod.yml down -v" -ForegroundColor Gray
Write-Host ""
