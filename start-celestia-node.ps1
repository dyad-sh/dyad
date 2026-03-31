#!/usr/bin/env pwsh
# Start Celestia Light Node on Mainnet (via Docker)
# Run this with: .\start-celestia-node.ps1

Write-Host "🌌 Starting Celestia Light Node (Mainnet via Docker)..." -ForegroundColor Cyan

# Check if Docker is available
if (!(Get-Command docker -ErrorAction SilentlyContinue)) {
    Write-Host "❌ Docker not found. Please install Docker Desktop first." -ForegroundColor Red
    exit 1
}

# Check if Docker daemon is running
$dockerInfo = docker info 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Docker daemon is not running. Start Docker Desktop first." -ForegroundColor Red
    exit 1
}

# Check if node is already running
$running = docker ps --filter "name=celestia-mainnet-node" --format "{{.Names}}" 2>$null
if ($running -eq "celestia-mainnet-node") {
    Write-Host "⚠️  Celestia node is already running in Docker" -ForegroundColor Yellow
    Write-Host "   RPC: http://localhost:26658" -ForegroundColor Gray
    Write-Host "   Logs: docker logs -f celestia-mainnet-node" -ForegroundColor Gray
    Write-Host "   Stop: .\stop-celestia-node.ps1" -ForegroundColor Gray
    exit 0
}

# Remove stopped container if it exists
docker rm celestia-mainnet-node 2>$null | Out-Null

# Start the node using docker compose
Write-Host "🚀 Starting node via Docker Compose..." -ForegroundColor Green
Write-Host "   RPC: http://localhost:26658" -ForegroundColor Gray
Write-Host "   P2P: port 2121" -ForegroundColor Gray
Write-Host ""

docker compose -f "$PSScriptRoot\docker-compose.celestia.yml" up -d

if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Failed to start Celestia via Docker Compose" -ForegroundColor Red
    exit 1
}

Write-Host "⏳ Waiting for node to initialize..." -ForegroundColor Yellow

# Wait and check for healthy container
$maxAttempts = 15
$attempt = 0
$started = $false

while ($attempt -lt $maxAttempts -and !$started) {
    Start-Sleep -Seconds 4
    $status = docker inspect --format "{{.State.Status}}" celestia-mainnet-node 2>$null
    if ($status -eq "running") {
        $started = $true
    }
    $attempt++
    Write-Host "   Checking... (attempt $attempt/$maxAttempts) status=$status" -ForegroundColor Gray
}

if ($started) {
    Write-Host "✅ Celestia node started successfully in Docker!" -ForegroundColor Green
    Write-Host ""
    Write-Host "Commands:" -ForegroundColor Cyan
    Write-Host "  View logs:     docker logs -f celestia-mainnet-node" -ForegroundColor Gray
    Write-Host "  Check health:  docker inspect --format '{{.State.Health.Status}}' celestia-mainnet-node" -ForegroundColor Gray
    Write-Host "  Stop node:     .\stop-celestia-node.ps1" -ForegroundColor Gray

    # Show first few log lines
    Write-Host ""
    Write-Host "Recent log:" -ForegroundColor Cyan
    docker logs --tail 10 celestia-mainnet-node 2>&1
} else {
    Write-Host "❌ Node container not running after $maxAttempts attempts" -ForegroundColor Red
    Write-Host ""
    Write-Host "Checking logs..." -ForegroundColor Yellow
    docker logs --tail 20 celestia-mainnet-node 2>&1
}
