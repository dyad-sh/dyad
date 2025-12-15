#!/bin/bash
# =============================================================================
# WebSocket Diagnostic Script for Dyad
# Run from the server to test WebSocket connectivity
# =============================================================================

echo "╔════════════════════════════════════════════════════════════╗"
echo "║         WebSocket Diagnostic Tool                          ║"
echo "╚════════════════════════════════════════════════════════════╝"

# Test 1: Direct to backend (bypassing nginx)
echo -e "\n[Test 1] Direct WebSocket to Dyad backend..."
curl -s -i -N \
    -H "Connection: Upgrade" \
    -H "Upgrade: websocket" \
    -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==" \
    -H "Sec-WebSocket-Version: 13" \
    --max-time 5 \
    http://localhost:3007/ws/chat 2>&1 | head -20

echo ""

# Test 2: Through nginx (internal)
echo -e "\n[Test 2] WebSocket through internal Nginx..."
curl -s -i -N \
    -H "Connection: Upgrade" \
    -H "Upgrade: websocket" \
    -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==" \
    -H "Sec-WebSocket-Version: 13" \
    --max-time 5 \
    http://localhost:3007/ws/chat 2>&1 | head -20

echo ""

# Test 3: Check if upgrade requests are in nginx logs
echo -e "\n[Test 3] Recent nginx logs with upgrade headers..."
docker exec dyad-nginx tail -50 /var/log/nginx/access.log 2>/dev/null | grep -i "upgrade\|ws\|101" | tail -10 || echo "No WebSocket entries found"

echo ""

# Test 4: Check Dyad container logs for WebSocket connections
echo -e "\n[Test 4] Dyad container WebSocket logs..."
docker logs dyad-web 2>&1 | grep -i "\[WS\]\|websocket\|upgrade" | tail -20 || echo "No WebSocket logs found"

echo ""

# Test 5: External connectivity (if curl supports websocket protocol)
echo -e "\n[Test 5] Health check via external domain..."
curl -s https://dyad1.ty-dev.site/api/health 2>/dev/null && echo "✅ External API OK" || echo "❌ External API failed"

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "If Test 1 shows '101 Switching Protocols' but Test 5 fails,"
echo "the issue is with your external SSL proxy (Cloudflare/Caddy/etc)."
echo ""
echo "Common fixes:"
echo "  - Cloudflare: Dashboard > Network > Enable 'WebSockets'"
echo "  - Caddy: WebSockets work by default"
echo "  - AWS ALB: WebSockets are supported by default"
echo "  - Nginx (external): Add 'Upgrade' and 'Connection' header forwarding"
echo "═══════════════════════════════════════════════════════════════"
