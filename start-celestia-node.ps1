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

# Remove stale lock file if it exists (from previous crash)
wsl bash -c "rm -f ~/.celestia-light/.lock" 2>$null

# Start the node in WSL background using tmux
Write-Host "🚀 Starting node in WSL..." -ForegroundColor Green
Write-Host "   RPC: http://localhost:26658" -ForegroundColor Gray
Write-Host "   Store: ~/.celestia-light" -ForegroundColor Gray
Write-Host "" 

# Kill any existing tmux session for celestia
wsl bash -c "tmux kill-session -t celestia 2>/dev/null" 2>$null

# Start celestia in a new tmux session
wsl bash -c "tmux new-session -d -s celestia 'celestia light start --core.ip consensus.lunaroasis.net --p2p.network celestia --rpc.addr 0.0.0.0 --rpc.port 26658 2>&1 | tee ~/celestia-node.log'"

Write-Host "⏳ Waiting for node to initialize..." -ForegroundColor Yellow

# Wait longer and check multiple times for the process
$maxAttempts = 10
$attempt = 0
$started = $false

while ($attempt -lt $maxAttempts -and !$started) {
    Start-Sleep -Seconds 2
    $process = wsl pgrep -f "celestia light" 2>$null
    if ($process) {
        $started = $true
    }
    $attempt++
    Write-Host "   Checking... (attempt $attempt/$maxAttempts)" -ForegroundColor Gray
}

# Check if started
if ($started) {
    Write-Host "✅ Celestia node started successfully in WSL!" -ForegroundColor Green
    Write-Host "   PID: $process" -ForegroundColor Gray
    Write-Host "   tmux session: celestia" -ForegroundColor Gray
    Write-Host ""
    Write-Host "Commands:" -ForegroundColor Cyan
    Write-Host "  Attach logs:   wsl tmux attach -t celestia" -ForegroundColor Gray
    Write-Host "  Check status:  wsl celestia state balance" -ForegroundColor Gray
    Write-Host "  View logs:     wsl tail -f ~/celestia-node.log" -ForegroundColor Gray
    Write-Host "  Stop node:     .\stop-celestia-node.ps1" -ForegroundColor Gray
    
    # Show first few lines of log
    Write-Host ""
    Write-Host "Recent log:" -ForegroundColor Cyan
    wsl bash -c "tail -5 ~/celestia-node.log 2>/dev/null"
} else {
    Write-Host "❌ Failed to start node" -ForegroundColor Red
    Write-Host ""
    Write-Host "Checking logs..." -ForegroundColor Yellow
    $logExists = wsl bash -c "test -f ~/celestia-node.log && echo yes"
    if ($logExists -eq "yes") {
        Write-Host "Log content:" -ForegroundColor Cyan
        wsl bash -c "cat ~/celestia-node.log 2>/dev/null"
    } else {
        Write-Host "No log file created. The process may have exited immediately." -ForegroundColor Red
    }
    Write-Host ""
    Write-Host "Try running manually: wsl celestia light start --core.ip consensus.lunaroasis.net --p2p.network celestia" -ForegroundColor Yellow
}
