#!/usr/bin/env pwsh
# =============================================================================
# Script PowerShell : Activer Dyad Pro en mode développement
# Usage: .\enable-pro-dev.ps1
# =============================================================================

Write-Host "🚀 Activation de Dyad Pro en mode développement..." -ForegroundColor Cyan
Write-Host ""

# Chemins
$dyadDataPath = "$env:APPDATA\dyad"
$settingsPath = "$dyadDataPath\settings.json"
$envPath = ".env"

Write-Host "📁 Chemins:" -ForegroundColor Yellow
Write-Host "   Settings: $settingsPath" -ForegroundColor Gray
Write-Host "   Env file: $envPath" -ForegroundColor Gray
Write-Host ""

# ============================================================================
# Étape 1: Modifier les settings JSON
# ============================================================================

if (Test-Path $settingsPath) {
    Write-Host "📝 Modification des settings utilisateur..." -ForegroundColor Yellow

    # Backup
    $backupPath = "$settingsPath.backup.$(Get-Date -Format 'yyyyMMddHHmmss')"
    Copy-Item $settingsPath $backupPath
    Write-Host "   ✅ Backup créé: $backupPath" -ForegroundColor Green

    try {
        # Charger les settings
        $settings = Get-Content $settingsPath -Raw | ConvertFrom-Json

        # Activer Dyad Pro
        $settings | Add-Member -NotePropertyName "enableDyadPro" -NotePropertyValue $true -Force

        # Ajouter une clé dev si nécessaire
        if (-not $settings.providerSettings) {
            $settings | Add-Member -NotePropertyName "providerSettings" -NotePropertyValue @{} -Force
        }
        if (-not $settings.providerSettings.auto) {
            $settings.providerSettings | Add-Member -NotePropertyName "auto" -NotePropertyValue @{} -Force
        }
        $settings.providerSettings.auto | Add-Member -NotePropertyName "apiKey" -NotePropertyValue @{
            value = "dev-bypass-key-$(Get-Date -Format 'yyyyMMdd')"
        } -Force

        # Activer le mode test
        $settings | Add-Member -NotePropertyName "isTestMode" -NotePropertyValue $true -Force

        # Sauvegarder
        $settings | ConvertTo-Json -Depth 20 | Set-Content $settingsPath -Encoding UTF8

        Write-Host "   ✅ Settings mis à jour" -ForegroundColor Green
        Write-Host "      - enableDyadPro: true" -ForegroundColor Gray
        Write-Host "      - isTestMode: true" -ForegroundColor Gray
        Write-Host "      - apiKey: dev-bypass-key" -ForegroundColor Gray
    }
    catch {
        Write-Host "   ❌ Erreur lors de la modification des settings: $_" -ForegroundColor Red
        Write-Host "   Restauration du backup..." -ForegroundColor Yellow
        Copy-Item $backupPath $settingsPath -Force
    }
}
else {
    Write-Host "   ⚠️  Fichier settings non trouvé" -ForegroundColor Yellow
    Write-Host "      Le fichier sera créé au premier lancement de Dyad" -ForegroundColor Gray
}

Write-Host ""

# ============================================================================
# Étape 2: Modifier le fichier .env
# ============================================================================

Write-Host "🔧 Configuration des variables d'environnement..." -ForegroundColor Yellow

$envContent = @"
# =============================================================================
# Dyad Pro - Mode Développement
# Généré automatiquement par enable-pro-dev.ps1
# =============================================================================

# Bypass Dyad Pro verification in development
DYAD_DEV_PRO_BYPASS=true

# Mode développement
NODE_ENV=development

# Variables existantes (à configurer)
OPENAI_API_KEY=
ANTHROPIC_API_KEY=
GOOGLE_GENERATIVE_AI_API_KEY=

"@

if (Test-Path $envPath) {
    # Backup .env existant
    $envBackup = ".env.backup.$(Get-Date -Format 'yyyyMMddHHmmss')"
    Copy-Item $envPath $envBackup
    Write-Host "   ✅ Backup .env créé: $envBackup" -ForegroundColor Green

    # Lire le contenu existant
    $existingEnv = Get-Content $envPath -Raw

    # Vérifier si DYAD_DEV_PRO_BYPASS existe déjà
    if ($existingEnv -match "DYAD_DEV_PRO_BYPASS") {
        # Remplacer la valeur
        $existingEnv = $existingEnv -replace "DYAD_DEV_PRO_BYPASS=.*", "DYAD_DEV_PRO_BYPASS=true"
        $existingEnv | Set-Content $envPath -NoNewline
        Write-Host "   ✅ Variable DYAD_DEV_PRO_BYPASS mise à jour" -ForegroundColor Green
    }
    else {
        # Ajouter la variable
        Add-Content $envPath "`n`n# Dyad Pro Dev Mode`nDYAD_DEV_PRO_BYPASS=true"
        Write-Host "   ✅ Variable DYAD_DEV_PRO_BYPASS ajoutée" -ForegroundColor Green
    }
}
else {
    # Créer nouveau .env
    $envContent | Set-Content $envPath -Encoding UTF8
    Write-Host "   ✅ Fichier .env créé" -ForegroundColor Green
}

Write-Host ""

# ============================================================================
# Étape 3: Variables d'environnement PowerShell
# ============================================================================

Write-Host "🌍 Configuration de la session PowerShell..." -ForegroundColor Yellow
$env:DYAD_DEV_PRO_BYPASS = "true"
Write-Host "   ✅ Variable DYAD_DEV_PRO_BYPASS définie pour cette session" -ForegroundColor Green

Write-Host ""

# ============================================================================
# Résumé
# ============================================================================

Write-Host "╔════════════════════════════════════════════════════════════╗" -ForegroundColor Green
Write-Host "║          ✅ Dyad Pro activé en mode développement         ║" -ForegroundColor Green
Write-Host "╚════════════════════════════════════════════════════════════╝" -ForegroundColor Green
Write-Host ""
Write-Host "🎯 Fonctionnalités débloquées:" -ForegroundColor Cyan
Write-Host "   ✓ Turbo Edits (Search & Replace)" -ForegroundColor White
Write-Host "   ✓ Smart Context (Deep / Balanced)" -ForegroundColor White
Write-Host "   ✓ Web Search" -ForegroundColor White
Write-Host "   ✓ Visual Editing" -ForegroundColor White
Write-Host "   ✓ Agent Local complet" -ForegroundColor White
Write-Host ""
Write-Host "📝 Prochaines étapes:" -ForegroundColor Yellow
Write-Host "   1. Redémarrez Dyad si déjà lancé" -ForegroundColor Gray
Write-Host "   2. Vérifiez que 'Pro' apparaît en haut à droite" -ForegroundColor Gray
Write-Host "   3. Ouvrez les paramètres Pro (icône ⚡)" -ForegroundColor Gray
Write-Host "   4. Toutes les fonctionnalités Pro sont maintenant actives!" -ForegroundColor Gray
Write-Host ""
Write-Host "⚠️  Important:" -ForegroundColor Red
Write-Host "   Ce mode est UNIQUEMENT pour le développement local" -ForegroundColor Yellow
Write-Host "   N'utilisez pas ce bypass en production" -ForegroundColor Yellow
Write-Host ""
Write-Host "🔄 Pour désactiver:" -ForegroundColor Cyan
Write-Host "   .\disable-pro-dev.ps1" -ForegroundColor Gray
Write-Host ""
