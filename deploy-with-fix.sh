#!/bin/bash
set -e

# =============================================================================
# Deployment Script for Dyad Fixes
# Automates the update and rebuild process to apply recent code changes.
# =============================================================================

echo -e "\033[0;34m[Deploy] Starting deployment of fixes...\033[0m"

# 1. Pull latest changes
echo -e "\033[0;33m[Deploy] Pulling latest code...\033[0m"
git pull origin main

# 2. Stop existing containers to ensure clean state
echo -e "\033[0;33m[Deploy] Stopping containers...\033[0m"
docker compose down

# 3. Clean up potentially stale images (optional but recommended for build fixes)
# echo "[Deploy] Cleaning up old images..."
# docker image prune -f

# 4. Rebuild and Start
# Using --no-cache to ensure the TypeScript fix in apps.ts is compiled
echo -e "\033[0;33m[Deploy] Rebuilding and starting services...\033[0m"
docker compose up -d --build --force-recreate

# 5. Verify Status
echo -e "\033[0;33m[Deploy] Verifying services...\033[0m"
sleep 5
docker compose ps

# 6. Check Logs for WebSocket Server
echo -e "\033[0;34m[Deploy] Checking logs for startup success...\033[0m"
echo "---------------------------------------------------"
docker compose logs --tail=20 dyad
echo "---------------------------------------------------"

echo -e "\033[0;32m[Deploy] Deployment request complete. Please check the logs above for any errors.\033[0m"
echo -e "\033[0;32m[Deploy] If successful, visit https://dyad1.ty-dev.site to verify the fix.\033[0m"
