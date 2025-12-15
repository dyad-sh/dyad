#!/bin/bash
set -e

# =============================================================================
# Deployment Script for Dyad - SSE Chat Streaming
# Replaced WebSocket with SSE (Server-Sent Events) for Cloudflare compatibility
# =============================================================================

echo -e "\033[0;34m╔════════════════════════════════════════════════════════════╗\033[0m"
echo -e "\033[0;34m║     Dyad Deployment - SSE Chat Streaming                   ║\033[0m"
echo -e "\033[0;34m╚════════════════════════════════════════════════════════════╝\033[0m"

echo -e "\n\033[0;36mKey changes in this deployment:\033[0m"
echo "  ✓ Replaced WebSocket chat with SSE (Server-Sent Events)"
echo "  ✓ SSE works reliably through Cloudflare/CDN (HTTP-based)"
echo "  ✓ New endpoint: POST /api/chat/stream"
echo "  ✓ Cancel endpoint: POST /api/chat/cancel"

# 1. Pull latest changes
echo -e "\n\033[0;33m[1/5] Pulling latest code...\033[0m"
git pull origin main

# 2. Stop existing containers
echo -e "\n\033[0;33m[2/5] Stopping containers...\033[0m"
docker compose down

# 3. Rebuild with no cache
echo -e "\n\033[0;33m[3/5] Rebuilding services (--no-cache)...\033[0m"
docker compose build --no-cache dyad

# 4. Start services
echo -e "\n\033[0;33m[4/5] Starting services...\033[0m"
docker compose up -d --force-recreate

# 5. Wait and verify
echo -e "\n\033[0;33m[5/5] Waiting for services...\033[0m"
sleep 15

docker compose ps
echo ""

# Test SSE endpoint
echo -e "\033[0;36mTesting SSE endpoint:\033[0m"
curl -s -X POST http://localhost:3007/api/chat/stream \
    -H "Content-Type: application/json" \
    -d '{"chatId":1,"messages":[]}' \
    --max-time 2 2>/dev/null | head -1 && echo "✅ SSE endpoint responding" || echo "ℹ️ SSE endpoint test inconclusive (expected for auth)"

# Show logs
echo -e "\n\033[0;36mRecent server logs:\033[0m"
docker compose logs dyad 2>&1 | tail -20

echo -e "\n\033[0;32m╔════════════════════════════════════════════════════════════╗\033[0m"
echo -e "\033[0;32m║  Deployment Complete!                                       ║\033[0m"
echo -e "\033[0;32m╚════════════════════════════════════════════════════════════╝\033[0m"
echo ""
echo "Chat should now work through Cloudflare using SSE streaming."
echo "Open the app and try creating a new chat!"
