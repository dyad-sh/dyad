#!/bin/bash
set -e

# =============================================================================
# Deployment Script for Dyad - WebSocket Fix v2
# Key fixes: Disabled WebSocket compression (perMessageDeflate: false)
# =============================================================================

echo -e "\033[0;34m╔════════════════════════════════════════════════════════════╗\033[0m"
echo -e "\033[0;34m║     Dyad Deployment - WebSocket Compression Fix            ║\033[0m"
echo -e "\033[0;34m╚════════════════════════════════════════════════════════════╝\033[0m"

echo -e "\n\033[0;36mKey changes in this deployment:\033[0m"
echo "  ✓ Disabled WebSocket perMessageDeflate compression"
echo "  ✓ Added WebSocket ping/pong heartbeat (30s interval)"
echo "  ✓ Improved nginx WebSocket configuration"
echo "  ✓ Better error logging"

# 1. Pull latest changes
echo -e "\n\033[0;33m[1/5] Pulling latest code...\033[0m"
git pull origin main

# 2. Stop existing containers
echo -e "\n\033[0;33m[2/5] Stopping containers...\033[0m"
docker compose down

# 3. Rebuild and Start with no cache to ensure fresh build
echo -e "\n\033[0;33m[3/5] Rebuilding services with --no-cache...\033[0m"
docker compose build --no-cache dyad
docker compose up -d --force-recreate

# 4. Wait for services to be ready
echo -e "\n\033[0;33m[4/5] Waiting for services to start...\033[0m"
sleep 15

# 5. Verify Status
echo -e "\n\033[0;33m[5/5] Checking status...\033[0m"
docker compose ps

# Show relevant logs
echo -e "\n\033[0;36mWebSocket server initialization logs:\033[0m"
echo "---------------------------------------------------"
docker compose logs dyad 2>&1 | grep -i "\[WS\]\|websocket\|server running" | tail -10
echo "---------------------------------------------------"

# Test internal connectivity
echo -e "\n\033[0;36mTesting internal WebSocket connectivity:\033[0m"
docker exec dyad-nginx sh -c "wget -q -O- http://dyad:3007/api/health 2>/dev/null" && echo "✅ Backend OK" || echo "❌ Backend failed"

echo -e "\n\033[0;32m╔════════════════════════════════════════════════════════════╗\033[0m"
echo -e "\033[0;32m║  Deployment Complete!                                       ║\033[0m"
echo -e "\033[0;32m╚════════════════════════════════════════════════════════════╝\033[0m"

echo -e "\nTest WebSocket connection in browser console:"
echo '  const ws = new WebSocket("wss://dyad1.ty-dev.site/ws/chat");'
echo '  ws.onopen = () => console.log("Connected!");'
echo '  ws.onerror = (e) => console.error("Error:", e);'
echo '  ws.onclose = (e) => console.log("Close:", e.code, e.reason);'
