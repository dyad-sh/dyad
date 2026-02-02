#!/usr/bin/env pwsh
# Stop Celestia Light Node (WSL)

Write-Host "🛑 Stopping Celestia node in WSL..." -ForegroundColor Yellow

$process = wsl pgrep -f "celestia light"
if ($process) {
    wsl pkill -f "celestia light"
    Write-Host "✅ Node stopped" -ForegroundColor Green
} else {
    Write-Host "⚠️  No running node found in WSL" -ForegroundColor Gray
}
