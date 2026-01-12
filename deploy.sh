#!/bin/bash
# =============================================================================
# Dyad Web Application - Deployment Script
# =============================================================================

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Functions
print_header() {
    echo ""
    echo -e "${BLUE}╔════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${BLUE}║${NC}  $1"
    echo -e "${BLUE}╚════════════════════════════════════════════════════════════╝${NC}"
}

print_success() {
    echo -e "${GREEN}✓${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}⚠${NC} $1"
}

print_error() {
    echo -e "${RED}✗${NC} $1"
}

# Check prerequisites
check_prereqs() {
    print_header "Checking Prerequisites"
    
    if ! command -v docker &> /dev/null; then
        print_error "Docker is not installed"
        exit 1
    fi
    print_success "Docker is installed"
    
    if ! command -v docker-compose &> /dev/null && ! docker compose version &> /dev/null; then
        print_error "Docker Compose is not installed"
        exit 1
    fi
    print_success "Docker Compose is installed"
}

# Build command
build() {
    print_header "Building Docker Images"
    docker compose build
    print_success "Build complete"
}

# Deploy Traefik Config
deploy_traefik_config() {
    print_header "Deploying Traefik Configuration"
    if [ -d "/data/coolify/proxy/dynamic" ]; then
        cp traefik-dyad-apps.yml /data/coolify/proxy/dynamic/dyad-apps.yml
        print_success "Traefik config copied to /data/coolify/proxy/dynamic/dyad-apps.yml"
    else
        print_warning "Coolify proxy folder not found at /data/coolify/proxy/dynamic"
        print_warning "Skipping Traefik config deployment. Please manually copy traefik-dyad-apps.yml to your proxy's dynamic config folder."
    fi
}

# Start command
start() {
    print_header "Starting Dyad Web Application (Server - Node Native)"
    
    # Copy Traefik dynamic config if running in Coolify environment
    if [ -d "/data/coolify/proxy/dynamic" ]; then
        print_header "Updating Traefik Config"
        cp traefik-dyad-apps.yml /data/coolify/proxy/dynamic/dyad-apps.yml
        print_success "Traefik configuration updated"
    fi

    docker compose up -d
    print_success "Dyad is running."
    print_success "- Backend: http://localhost:3007"
    print_success "- App Subdomains: https://app-dyad-{id}.ty-dev.site"
}

# Start with nginx
start_with_nginx() {
    print_header "Starting Dyad with Nginx"
    docker compose --profile with-nginx up -d
    print_success "Dyad is running at http://localhost (with Nginx)"
}

# Start with MCP server
start_with_mcp() {
    print_header "Starting Dyad with MCP Server"
    docker compose --profile with-mcp up -d
    print_success "Dyad and MCP server are running"
}

# Start all services
start_all() {
    print_header "Starting All Services"
    docker compose --profile with-nginx --profile with-mcp up -d
    print_success "All services are running"
}

# Stop command
stop() {
    print_header "Stopping Dyad"
    docker compose --profile with-nginx --profile with-mcp down
    print_success "All services stopped"
}

# Logs command
logs() {
    docker compose logs -f "${1:-dyad}"
}

# Status command
status() {
    print_header "Service Status"
    docker compose ps
}

# Clean command
clean() {
    print_header "Cleaning Up"
    docker compose --profile with-nginx --profile with-mcp down -v --rmi local
    print_success "Cleanup complete"
}

# Update command
update() {
    print_header "Updating Dyad"
    git pull
    build
    stop
    start
    print_success "Update complete"
}

# Backup command
backup() {
    print_header "Backing Up Data"
    BACKUP_FILE="dyad-backup-$(date +%Y%m%d-%H%M%S).tar.gz"
    docker run --rm -v dyad-web_dyad-data:/data -v $(pwd):/backup alpine \
        tar czf /backup/$BACKUP_FILE -C /data .
    print_success "Backup saved to $BACKUP_FILE"
}

# Restore command
restore() {
    if [ -z "$1" ]; then
        print_error "Usage: $0 restore <backup-file>"
        exit 1
    fi
    print_header "Restoring Data"
    docker run --rm -v dyad-web_dyad-data:/data -v $(pwd):/backup alpine \
        sh -c "rm -rf /data/* && tar xzf /backup/$1 -C /data"
    print_success "Data restored from $1"
}

# Help
show_help() {
    echo ""
    echo "Usage: $0 <command>"
    echo ""
    echo "Commands:"
    echo "  build          Build Docker images"
    echo "  start          Start Dyad (basic)"
    echo "  start-nginx    Start Dyad with Nginx reverse proxy"
    echo "  start-mcp      Start Dyad with MCP server"
    echo "  start-all      Start all services"
    echo "  stop           Stop all services"
    echo "  restart        Restart services"
    echo "  logs [service] View logs (default: dyad)"
    echo "  status         Show service status"
    echo "  update         Pull latest code and rebuild"
    echo "  backup         Backup data volume"
    echo "  restore <file> Restore from backup"
    echo "  clean          Remove containers, volumes, and images"
    echo "  help           Show this help"
    echo ""
}

# Main
case "${1:-help}" in
    build)
        check_prereqs
        build
        ;;
    start)
        check_prereqs
        start
        ;;
    start-nginx)
        check_prereqs
        start_with_nginx
        ;;
    start-mcp)
        check_prereqs
        start_with_mcp
        ;;
    start-all)
        check_prereqs
        start_all
        ;;
    stop)
        stop
        ;;
    restart)
        stop
        start
        ;;
    logs)
        logs "$2"
        ;;
    status)
        status
        ;;
    update)
        check_prereqs
        update
        ;;
    backup)
        backup
        ;;
    restore)
        restore "$2"
        ;;
    clean)
        clean
        ;;
    help|*)
        show_help
        ;;
esac
