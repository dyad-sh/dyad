@echo off
REM Quick start for Celestia node (Docker)
echo Starting Celestia Light Node via Docker...
docker compose -f "%~dp0docker-compose.celestia.yml" up -d
echo.
echo RPC available at http://localhost:26658
echo Logs: docker logs -f celestia-mainnet-node
pause
