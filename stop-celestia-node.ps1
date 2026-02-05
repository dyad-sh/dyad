#!/usr/bin/env pwsh
# Stop Celestia Light Node (WSL)

Write-Host "🛑 Stopping Celestia node in WSL..." -ForegroundColor Yellow

$process = wsl pgrep -f "celestia light"
if ($process) {
    wsl pkill -f "celestia light"
    Write-Host "✅ Node stopped (PID: $process)" -ForegroundColor Green
} else {
    Write-Host "⚠️  No running celestia process found in WSL" -ForegroundColor Gray
}

# Also kill tmux session if it exists
$tmuxSession = wsl bash -c "tmux has-session -t celestia 2>/dev/null && echo yes"
if ($tmuxSession -eq "yes") {
    wsl bash -c "tmux kill-session -t celestia"
    Write-Host "✅ tmux session 'celestia' terminated" -ForegroundColor Green
}
