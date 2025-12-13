# Script pour vérifier et corriger la clé Google API

Write-Host "═══════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "  Diagnostic de la Clé Google API" -ForegroundColor Cyan
Write-Host "═══════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""

# 1. Vérifier la configuration actuelle
Write-Host "1. Configuration actuelle via API:" -ForegroundColor Yellow
$settings = Invoke-RestMethod -Uri 'https://dyad1.ty-dev.site/api/settings' -Method GET
Write-Host "   Modèle: $($settings.data.defaultModel)" -ForegroundColor White
Write-Host "   Clé Google: $($settings.data.googleApiKey)" -ForegroundColor White
Write-Host ""

# 2. Vérifier si c'est la bonne clé
$expectedKey = "AIzaSyAFtBsBClS3PgCMaJUIJAif3ln6-1eJqjU"
if ($settings.data.googleApiKey -eq $expectedKey) {
    Write-Host "   ✅ La clé API est correcte dans les settings" -ForegroundColor Green
} else {
    Write-Host "   ❌ La clé API est différente !" -ForegroundColor Red
    Write-Host "   Attendue: $expectedKey" -ForegroundColor Yellow
    Write-Host "   Actuelle: $($settings.data.googleApiKey)" -ForegroundColor Yellow
}
Write-Host ""

# 3. Tester la clé directement avec Google API
Write-Host "2. Test direct de la clé avec Google Gemini API:" -ForegroundColor Yellow
$testUrl = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=$expectedKey"
$testBody = @{
    contents = @(
        @{
            parts = @(
                @{
                    text = "Hello"
                }
            )
        }
    )
} | ConvertTo-Json -Depth 10

try {
    $response = Invoke-RestMethod -Uri $testUrl -Method POST -ContentType 'application/json' -Body $testBody
    Write-Host "   ✅ La clé fonctionne avec Google API !" -ForegroundColor Green
    Write-Host "   Réponse: $($response.candidates[0].content.parts[0].text.Substring(0, 50))..." -ForegroundColor White
} catch {
    Write-Host "   ❌ Erreur avec la clé Google:" -ForegroundColor Red
    $errorDetails = $_.Exception.Response
    if ($errorDetails) {
        $reader = New-Object System.IO.StreamReader($errorDetails.GetResponseStream())
        $errorBody = $reader.ReadToEnd()
        Write-Host "   $errorBody" -ForegroundColor Yellow
    } else {
        Write-Host "   $($_.Exception.Message)" -ForegroundColor Yellow
    }
}
Write-Host ""

# 4. Vérifier les logs serveur
Write-Host "3. Dernières erreurs dans les logs serveur:" -ForegroundColor Yellow
Write-Host "   (Vérifiez log.log pour voir les détails complets)" -ForegroundColor Gray
Write-Host ""

Write-Host "═══════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "  Recommandations:" -ForegroundColor Cyan
Write-Host "═══════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""
Write-Host "Si la clé fonctionne en test direct mais pas sur le serveur:" -ForegroundColor White
Write-Host "  1. Le serveur utilise l'ancien code (pas encore déployé)" -ForegroundColor Gray
Write-Host "  2. Il faut commit + push le nouveau code" -ForegroundColor Gray
Write-Host "  3. Attendre le redéploiement automatique (~2-3 min)" -ForegroundColor Gray
Write-Host ""
Write-Host "Si la clé ne fonctionne pas en test direct:" -ForegroundColor White
Write-Host "  1. Vérifier le projet Google Cloud" -ForegroundColor Gray
Write-Host "  2. Activer la facturation si nécessaire" -ForegroundColor Gray
Write-Host "  3. Ou utiliser une autre clé/projet" -ForegroundColor Gray
Write-Host ""
