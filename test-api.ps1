# Script de test des endpoints API Dyad
# Usage: .\test-api.ps1

$baseUrl = "https://dyad1.ty-dev.site"

Write-Host "`n=== Test 1: Health Check ===" -ForegroundColor Cyan
try {
    $response = Invoke-RestMethod -Uri "$baseUrl/api/health" -Method Get
    Write-Host "✅ Health check OK: $($response | ConvertTo-Json)" -ForegroundColor Green
} catch {
    Write-Host "❌ Health check failed: $_" -ForegroundColor Red
}

Write-Host "`n=== Test 2: Liste des Apps ===" -ForegroundColor Cyan
try {
    $response = Invoke-RestMethod -Uri "$baseUrl/api/apps" -Method Get
    Write-Host "✅ Apps found: $($response.apps.Count)" -ForegroundColor Green
    $response.apps | Select-Object id, name, createdAt | Format-Table
} catch {
    Write-Host "❌ Apps request failed: $_" -ForegroundColor Red
}

Write-Host "`n=== Test 3: Liste des Chats ===" -ForegroundColor Cyan
try {
    $response = Invoke-RestMethod -Uri "$baseUrl/api/chats" -Method Get
    Write-Host "✅ Chats found: $($response.chats.Count)" -ForegroundColor Green
    $response.chats | Select-Object id, title, appId | Format-Table
} catch {
    Write-Host "❌ Chats request failed: $_" -ForegroundColor Red
}

Write-Host "`n=== Test 4: Vérifier /providers/google (devrait échouer) ===" -ForegroundColor Cyan
try {
    $response = Invoke-RestMethod -Uri "$baseUrl/providers/google" -Method Get
    Write-Host "⚠️ Unexpected success: $($response | ConvertTo-Json)" -ForegroundColor Yellow
} catch {
    Write-Host "✅ Attendu: Cette route n'existe pas (404)" -ForegroundColor Green
    Write-Host "   Erreur: $_" -ForegroundColor Gray
}

Write-Host "`n=== Résumé ===" -ForegroundColor Cyan
Write-Host "Les providers sont intégrés dans le code, pas exposés via API." -ForegroundColor Yellow
Write-Host "Utilisez les clés API dans .env pour activer les providers." -ForegroundColor Yellow
