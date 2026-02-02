#!/usr/bin/env pwsh
# Start Celestia Light Node on Mainnet (via WSL)
# Run this with: .\start-celestia-node.ps1

Write-Host "🌌 Starting Celestia Light Node (Mainnet via WSL)..." -ForegroundColor Cyan

# Check if WSL is available
if (!(Get-Command wsl -ErrorAction SilentlyContinue)) {
    Write-Host "❌ WSL not found. Please install WSL first." -ForegroundColor Red
    exit 1
}

# Check if node is already running in WSL
$running = wsl pgrep -f "celestia light"
if ($running) {
    Write-Host "⚠️  Celestia node is already running in WSL" -ForegroundColor Yellow
    Write-Host "To stop: .\stop-celestia-node.ps1" -ForegroundColor Gray
    exit 0
}

# Check if celestia is installed in WSL
$celestiaExists = wsl which celestia 2>$null
if (!$celestiaExists) {
    Write-Host "❌ Celestia not found in WSL. Installing..." -ForegroundColor Red
    Write-Host "Run: wsl bash -c 'cd ~ && go install github.com/celestiaorg/celestia-node/cmd/celestia@latest'" -ForegroundColor Yellow
    exit 1
}

# Start the node in WSL background
Write-Host "🚀 Starting node in WSL..." -ForegroundColor Green
Write-Host "   RPC: http://localhost:26658" -ForegroundColor Gray
Write-Host "   Store: ~/.celestia-light" -ForegroundColor Gray
Write-Host "" 

wsl bash -c "nohup celestia light start --core.ip consensus.lunaroasis.net --p2p.network celestia --rpc.addr 0.0.0.0 --rpc.port 26658 > ~/celestia-node.log 2>&1 &"

Start-Sleep -Seconds 3

# Check if started
$process = wsl pgrep -f "celestia light"
if ($process) {
    Write-Host "✅ Celestia node started successfully in WSL!" -ForegroundColor Green
    Write-Host "   PID: $process" -ForegroundColor Gray
    Write-Host ""
    Write-Host "Commands:" -ForegroundColor Cyan
    Write-Host "  Check status:  wsl celestia state balance" -ForegroundColor Gray
    Write-Host "  View logs:     wsl tail -f ~/celestia-node.log" -ForegroundColor Gray
    Write-Host "  Stop node:     .\stop-celestia-node.ps1" -ForegroundColor Gray
} else {
    Write-Host "❌ Failed to start node" -ForegroundColor Red
    Write-Host "Check logs: wsl cat ~/celestia-node.log" -ForegroundColor Yellow
}
