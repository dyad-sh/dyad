#!/usr/bin/env pwsh
# =============================================================================
# Script PowerShell : Désactiver Dyad Pro en mode développement
# Usage: .\disable-pro-dev.ps1
# =============================================================================

Write-Host "🛑 Désactivation du mode développement Dyad Pro..." -ForegroundColor Yellow
Write-Host ""

# Chemins
$dyadDataPath = "$env:APPDATA\dyad"
$settingsPath = "$dyadDataPath\settings.json"
$envPath = ".env"

# ============================================================================
# Étape 1: Restaurer les settings
# ============================================================================

if (Test-Path $settingsPath) {
    Write-Host "📝 Nettoyage des settings..." -ForegroundColor Yellow
    
    try {
        $settings = Get-Content $settingsPath -Raw | ConvertFrom-Json
        
        # Désactiver le mode test
        if ($settings.PSObject.Properties.Name -contains "isTestMode") {
            $settings.isTestMode = $false
        }
        
        # Optionnel: désactiver Dyad Pro complètement
        # $settings.enableDyadPro = $false
        
        $settings | ConvertTo-Json -Depth 20 | Set-Content $settingsPath -Encoding UTF8
        Write-Host "   ✅ Settings nettoyés" -ForegroundColor Green
    }
    catch {
        Write-Host "   ❌ Erreur: $_" -ForegroundColor Red
    }
}

Write-Host ""

# ============================================================================
# Étape 2: Nettoyer .env
# ============================================================================

Write-Host "🔧 Nettoyage des variables d'environnement..." -ForegroundColor Yellow

if (Test-Path $envPath) {
    $envContent = Get-Content $envPath -Raw
    
    if ($envContent -match "DYAD_DEV_PRO_BYPASS") {
        $envContent = $envContent -replace "DYAD_DEV_PRO_BYPASS=true", "DYAD_DEV_PRO_BYPASS=false"
        $envContent | Set-Content $envPath -NoNewline
        Write-Host "   ✅ Variable DYAD_DEV_PRO_BYPASS désactivée" -ForegroundColor Green
    }
}

Write-Host ""

# ============================================================================
# Étape 3: Variables PowerShell
# ============================================================================

Write-Host "🌍 Nettoyage de la session..." -ForegroundColor Yellow
$env:DYAD_DEV_PRO_BYPASS = "false"
Write-Host "   ✅ Variable de session réinitialisée" -ForegroundColor Green

Write-Host ""
Write-Host "✅ Mode développement désactivé" -ForegroundColor Green
Write-Host "   Redémarrez Dyad pour appliquer les changements" -ForegroundColor Gray
Write-Host ""
