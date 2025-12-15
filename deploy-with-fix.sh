#!/bin/bash
set -e

# =============================================================================
# Deployment Script for Dyad with WebSocket Fix
# =============================================================================

echo -e "\033[0;34m╔════════════════════════════════════════════════════════════╗\033[0m"
echo -e "\033[0;34m║         Dyad Deployment - WebSocket Fix                    ║\033[0m"
echo -e "\033[0;34m╚════════════════════════════════════════════════════════════╝\033[0m"

# 1. Pull latest changes
echo -e "\n\033[0;33m[1/6] Pulling latest code...\033[0m"
git pull origin main

# 2. Stop existing containers
echo -e "\n\033[0;33m[2/6] Stopping containers...\033[0m"
docker compose down

# 3. Rebuild and Start
echo -e "\n\033[0;33m[3/6] Rebuilding and starting services...\033[0m"
docker compose up -d --build --force-recreate

# 4. Wait for services to be ready
echo -e "\n\033[0;33m[4/6] Waiting for services to start...\033[0m"
sleep 10

# 5. Verify Status
echo -e "\n\033[0;33m[5/6] Checking container status...\033[0m"
docker compose ps

# 6. Test WebSocket connectivity from inside container
echo -e "\n\033[0;33m[6/6] Testing WebSocket endpoint...\033[0m"
echo "---------------------------------------------------"

# Check if upgrade requests reach the server
echo -e "\n\033[0;36mRecent logs from dyad container:\033[0m"
docker compose logs --tail=30 dyad | grep -i "upgrade\|websocket\|ws\|error" || echo "No WebSocket-related logs found"

echo "---------------------------------------------------"

# Test WebSocket from inside nginx container to dyad
echo -e "\n\033[0;36mTesting internal WebSocket connectivity:\033[0m"
docker exec dyad-nginx sh -c "wget -q -O- http://dyad:3007/api/health" 2>/dev/null && echo "✅ Internal HTTP OK" || echo "❌ Internal HTTP failed"

# Check nginx configuration is valid
echo -e "\n\033[0;36mValidating nginx configuration:\033[0m"
docker exec dyad-nginx nginx -t 2>&1 && echo "✅ Nginx config valid" || echo "❌ Nginx config invalid"

# Test if WebSocket upgrade headers are being logged
echo -e "\n\033[0;36mNginx access log (last 10 lines):\033[0m"
docker exec dyad-nginx tail -10 /var/log/nginx/access.log 2>/dev/null || echo "No access logs yet"

echo -e "\n\033[0;32m╔════════════════════════════════════════════════════════════╗\033[0m"
echo -e "\033[0;32m║  Deployment Complete!                                       ║\033[0m"
echo -e "\033[0;32m╚════════════════════════════════════════════════════════════╝\033[0m"

echo -e "\n\033[0;33mIMPORTANT: If WebSocket still fails, check your external SSL proxy:\033[0m"
echo "  - Cloudflare: Enable WebSockets in Network settings"
echo "  - Caddy: WebSockets are enabled by default"
echo "  - Other proxy: Ensure Upgrade and Connection headers are forwarded"
echo ""
echo "To manually test WebSocket from server:"
echo "  curl -i -N -H 'Connection: Upgrade' -H 'Upgrade: websocket' \\"
echo "       -H 'Sec-WebSocket-Key: test' -H 'Sec-WebSocket-Version: 13' \\"
echo "       http://localhost:3007/ws/chat"
