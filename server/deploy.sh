#!/bin/bash

# =============================================================================
# Dyad Web Server - Deployment Script
# =============================================================================
# Usage: ./deploy.sh [command]
# Commands:
#   install   - Install dependencies and build
#   start     - Start the server
#   stop      - Stop the server
#   restart   - Restart the server
#   logs      - Show server logs
#   docker    - Deploy with Docker Compose
# =============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if .env exists
check_env() {
    if [ ! -f .env ]; then
        log_warn ".env file not found. Copying from .env.example..."
        if [ -f .env.example ]; then
            cp .env.example .env
            log_info "Created .env file. Please edit it with your API keys."
        else
            log_error ".env.example not found. Please create .env manually."
            exit 1
        fi
    fi
}

# Install dependencies and build
install() {
    log_info "Installing dependencies..."
    npm install

    log_info "Building TypeScript..."
    npm run build

    log_info "Installation complete!"
}

# Start server in background
start() {
    check_env
    log_info "Starting Dyad server..."
    
    if [ -f server.pid ]; then
        log_warn "Server may already be running. Use 'stop' first."
        exit 1
    fi

    nohup npm start > logs/server.log 2>&1 &
    echo $! > server.pid
    
    log_info "Server started with PID $(cat server.pid)"
    log_info "Logs available at: logs/server.log"
}

# Stop server
stop() {
    if [ -f server.pid ]; then
        PID=$(cat server.pid)
        log_info "Stopping server (PID: $PID)..."
        kill $PID 2>/dev/null || true
        rm server.pid
        log_info "Server stopped."
    else
        log_warn "No server.pid file found. Server may not be running."
    fi
}

# Restart server
restart() {
    stop
    sleep 2
    start
}

# Show logs
logs() {
    if [ -f logs/server.log ]; then
        tail -f logs/server.log
    else
        log_warn "No log file found. Server may not have been started."
    fi
}

# Deploy with Docker
docker_deploy() {
    check_env
    log_info "Deploying with Docker Compose..."
    docker-compose up -d --build
    log_info "Docker deployment complete!"
    docker-compose logs -f
}

# Create required directories
mkdir -p logs data

# Parse command
case "${1:-install}" in
    install)
        install
        ;;
    start)
        start
        ;;
    stop)
        stop
        ;;
    restart)
        restart
        ;;
    logs)
        logs
        ;;
    docker)
        docker_deploy
        ;;
    *)
        echo "Usage: $0 {install|start|stop|restart|logs|docker}"
        exit 1
        ;;
esac
