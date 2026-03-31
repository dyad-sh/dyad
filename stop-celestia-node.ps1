#!/usr/bin/env pwsh
# Stop Celestia Light Node (Docker)

Write-Host "🛑 Stopping Celestia node..." -ForegroundColor Yellow

$running = docker ps --filter "name=celestia-mainnet-node" --format "{{.Names}}" 2>$null
if ($running -eq "celestia-mainnet-node") {
    docker compose -f "$PSScriptRoot\docker-compose.celestia.yml" down
    Write-Host "✅ Celestia node stopped" -ForegroundColor Green
} else {
    Write-Host "⚠️  No running Celestia container found" -ForegroundColor Gray
}
