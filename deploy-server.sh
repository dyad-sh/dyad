#!/bin/bash
# Deployment script for Dyad server

echo "🚀 Starting deployment..."

# Navigate to project directory
cd /var/www/dyad || exit 1

# Pull latest code
echo "📥 Pulling latest code from git..."
git pull origin main

# Rebuild and restart server container
echo "🔨 Rebuilding server container..."
docker-compose build server

echo "♻️  Restarting server..."
docker-compose up -d server

# Wait for server to start
echo "⏳ Waiting for server to start..."
sleep 5

# Check server status
echo "✅ Checking server status..."
docker-compose ps server

echo "🎉 Deployment complete!"
