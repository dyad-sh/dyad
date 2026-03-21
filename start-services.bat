@echo off
REM JoyCreate - Start All Backend Services
echo ========================================
echo   JoyCreate Backend Services Launcher
echo ========================================
echo.

echo [1/3] Starting Docker services (n8n + PostgreSQL + Celestia + Collabora)...
docker compose -f docker-compose.n8n.yml up -d
docker compose -f docker-compose.celestia.yml up -d

echo.
echo [2/3] Starting OpenClaw Gateway on port 18789...
set OPENCLAW_GATEWAY_TOKEN=EmQaMfi9rqZ6ljctsWhkS5Tnb2K1RP8D
start "OpenClaw Gateway" /min cmd /c "npx openclaw gateway run --port 18789 --verbose"

echo.
echo [3/3] Waiting for services to initialize...
timeout /t 10 >nul

echo.
echo ========================================
echo   All backend services started!
echo ========================================
echo.
echo   n8n Workflows:      http://localhost:5678
echo   OpenClaw Control:   http://localhost:18789
echo   Collabora Office:   http://localhost:9980
echo   PostgreSQL:         localhost:5433
echo   Celestia Light Node: localhost:26658
echo.
echo   OpenClaw Token: %OPENCLAW_GATEWAY_TOKEN%
echo.
echo   To start the JoyCreate app: npm run start
echo.
pause
