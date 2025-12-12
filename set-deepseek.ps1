# Script PowerShell pour configurer DeepSeek comme modèle par défaut

Write-Host "🔄 Configuration de DeepSeek Chat v3.1 comme modèle par défaut..." -ForegroundColor Cyan

# Mettre à jour via l'API
$body = @{
    defaultModel = "gemini-2.0-flash-exp"
} | ConvertTo-Json

try {
    Write-Host "📡 Envoi de la requête..." -ForegroundColor Yellow
    
    $response = Invoke-RestMethod -Uri "https://dyad1.ty-dev.site/api/settings" `
        -Method PUT `
        -ContentType "application/json" `
        -Body $body

    Write-Host ""
    Write-Host "✅ Réponse de l'API:" -ForegroundColor Green
    $response | ConvertTo-Json -Depth 10

    Write-Host ""
    Write-Host "🔍 Vérification de la mise à jour..." -ForegroundColor Cyan
    
    # Vérifier le changement
    Start-Sleep -Seconds 2
    $settings = Invoke-RestMethod -Uri "https://dyad1.ty-dev.site/api/settings" -Method GET
    
    Write-Host ""
    Write-Host "📊 Modèle actuel: " -NoNewline -ForegroundColor Yellow
    Write-Host $settings.data.defaultModel -ForegroundColor White

    if ($settings.data.defaultModel -eq "gemini-2.0-flash-exp") {
        Write-Host ""
        Write-Host "✅ Modèle mis à jour avec succès !" -ForegroundColor Green
        Write-Host ""
        Write-Host "🎉 Vous pouvez maintenant tester le chat sur:" -ForegroundColor Cyan
        Write-Host "   https://dyad1.ty-dev.site/" -ForegroundColor White
        Write-Host ""
        Write-Host "💡 DeepSeek Chat v3.1 est gratuit via OpenRouter" -ForegroundColor Yellow
    } else {
        Write-Host ""
        Write-Host "⚠️ Le modèle n'a pas été mis à jour correctement" -ForegroundColor Red
        Write-Host "   Valeur actuelle: $($settings.data.defaultModel)" -ForegroundColor Yellow
    }
} catch {
    Write-Host ""
    Write-Host "❌ Erreur lors de la mise à jour:" -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
}

Write-Host ""
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor DarkGray
