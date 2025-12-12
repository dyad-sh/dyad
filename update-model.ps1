# Script PowerShell pour mettre à jour le modèle par défaut vers Gemini Flash

Write-Host "🔄 Mise à jour du modèle par défaut vers Gemini Flash..." -ForegroundColor Cyan

# Mettre à jour via l'API
$body = @{
    defaultModel = "gemini-2.0-flash-exp"
} | ConvertTo-Json

try {
    $response = Invoke-RestMethod -Uri "https://dyad1.ty-dev.site/api/settings" `
        -Method PUT `
        -ContentType "application/json" `
        -Body $body

    Write-Host "✅ Réponse de l'API:" -ForegroundColor Green
    $response | ConvertTo-Json -Depth 10

    Write-Host ""
    Write-Host "✅ Vérification de la mise à jour..." -ForegroundColor Cyan
    
    # Vérifier le changement
    $settings = Invoke-RestMethod -Uri "https://dyad1.ty-dev.site/api/settings" -Method GET
    Write-Host "Modèle actuel: $($settings.data.defaultModel)" -ForegroundColor Yellow

    if ($settings.data.defaultModel -eq "gemini-2.0-flash-exp") {
        Write-Host "✅ Modèle mis à jour avec succès !" -ForegroundColor Green
    } else {
        Write-Host "⚠️ Le modèle n'a pas été mis à jour. Valeur actuelle: $($settings.data.defaultModel)" -ForegroundColor Red
    }
} catch {
    Write-Host "❌ Erreur lors de la mise à jour:" -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
}
