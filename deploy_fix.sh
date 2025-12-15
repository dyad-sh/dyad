#!/bin/bash
# Script to ensure dependencies are installed and build is triggered
# Usage: ./deploy_fix.sh

echo "Deploy Fix Script Started..."

# 1. Install dependencies (respecting lockfile)
echo "Installing dependencies..."
npm ci

# 2. Build for production
echo "Building web assets..."
npm run web:build

echo "Build complete. Ready for deployment."
