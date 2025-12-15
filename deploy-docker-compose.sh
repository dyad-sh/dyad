#!/bin/bash

echo "=========================================="
echo "Deploying Docker Compose Architecture"
echo "=========================================="
echo ""

echo "📦 Committing changes..."
git add -A
git commit -m "feat: Docker Compose architecture - apps in isolated containers

- Created docker-compose.yml for Dyad server
- Created app.Dockerfile for Next.js apps
- Created DockerService to manage app containers
- Modified apps.ts to use Docker instead of spawn
- Apps run in isolated containers with fixed ports (32000 + appId)
- Direct URL access: http://dyad1.ty-dev.site:32XXX
- Removed proxy dependency

BREAKING CHANGE: Apps now require Docker Compose and exposed ports"

echo "✅ Changes committed"
echo ""

echo "🚀 Pushing to remote..."
git push origin main

echo ""
echo "=========================================="
echo "✅ Code Deployed!"
echo "=========================================="
echo ""
echo "⚠️  IMPORTANT: Server Setup Required"
echo ""
echo "On your server, run these commands:"
echo ""
echo "1. Create Docker network:"
echo "   docker network create dyad-network"
echo ""
echo "2. Create shared volume:"
echo "   docker volume create dyad-apps"
echo ""
echo "3. Rebuild and restart:"
echo "   docker-compose down"
echo "   docker-compose build"
echo "   docker-compose up -d"
echo ""
echo "4. Open ports for apps (32000-33000):"
echo "   sudo ufw allow 32000:33000/tcp"
echo ""
echo "5. Test with a new app:"
echo "   - Create new app on dyad1.ty-dev.site"
echo "   - Send message to AI"
echo "   - Access at http://dyad1.ty-dev.site:32XXX"
echo ""
echo "=========================================="
