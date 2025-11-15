#!/usr/bin/env bash

###############################################################################
# Dyad Development Environment Bootstrap Script
#
# This script automates the setup of the Dyad development environment.
# It performs the following tasks:
# - Validates Node.js and npm versions
# - Creates necessary directories
# - Installs dependencies
# - Sets up the database
# - Configures git hooks
# - Validates the environment
#
# Usage:
#   ./scripts/bootstrap.sh [--skip-deps] [--skip-db] [--skip-hooks]
#
# Options:
#   --skip-deps   Skip dependency installation
#   --skip-db     Skip database setup
#   --skip-hooks  Skip git hooks setup
#   --help        Show this help message
###############################################################################

set -e  # Exit on error
set -u  # Exit on undefined variable
set -o pipefail  # Exit on pipe failure

# Color codes for output
readonly RED='\033[0;31m'
readonly GREEN='\033[0;32m'
readonly YELLOW='\033[1;33m'
readonly BLUE='\033[0;34m'
readonly CYAN='\033[0;36m'
readonly BOLD='\033[1m'
readonly NC='\033[0m' # No Color

# Configuration
readonly REQUIRED_NODE_VERSION=20
readonly REQUIRED_NPM_VERSION=10

# Parse command line arguments
SKIP_DEPS=false
SKIP_DB=false
SKIP_HOOKS=false

while [[ $# -gt 0 ]]; do
  case $1 in
    --skip-deps)
      SKIP_DEPS=true
      shift
      ;;
    --skip-db)
      SKIP_DB=true
      shift
      ;;
    --skip-hooks)
      SKIP_HOOKS=true
      shift
      ;;
    --help)
      grep "^#" "$0" | grep -v "^#!/" | sed 's/^# //' | sed 's/^#//'
      exit 0
      ;;
    *)
      echo -e "${RED}Unknown option: $1${NC}"
      echo "Use --help for usage information"
      exit 1
      ;;
  esac
done

# Utility functions
log_info() {
  echo -e "${BLUE}ℹ${NC} $1"
}

log_success() {
  echo -e "${GREEN}✓${NC} $1"
}

log_warning() {
  echo -e "${YELLOW}⚠${NC} $1"
}

log_error() {
  echo -e "${RED}✗${NC} $1"
}

log_section() {
  echo ""
  echo -e "${CYAN}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${CYAN}${BOLD}$1${NC}"
  echo -e "${CYAN}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
}

# Check if a command exists
command_exists() {
  command -v "$1" >/dev/null 2>&1
}

# Get the major version from a semver string
get_major_version() {
  echo "$1" | sed 's/v//' | cut -d. -f1
}

# Validate Node.js version
validate_node_version() {
  log_section "Validating Node.js Environment"

  if ! command_exists node; then
    log_error "Node.js is not installed"
    log_info "Please install Node.js ${REQUIRED_NODE_VERSION}.x or higher"
    log_info "Visit: https://nodejs.org/"
    exit 1
  fi

  local node_version
  node_version=$(node --version)
  local node_major
  node_major=$(get_major_version "$node_version")

  if [[ "$node_major" -lt "$REQUIRED_NODE_VERSION" ]]; then
    log_error "Node.js version $node_version is too old"
    log_error "Required: Node.js ${REQUIRED_NODE_VERSION}.x or higher"
    exit 1
  fi

  log_success "Node.js version: $node_version"
}

# Validate npm version
validate_npm_version() {
  if ! command_exists npm; then
    log_error "npm is not installed"
    exit 1
  fi

  local npm_version
  npm_version=$(npm --version)
  local npm_major
  npm_major=$(get_major_version "$npm_version")

  if [[ "$npm_major" -lt "$REQUIRED_NPM_VERSION" ]]; then
    log_warning "npm version $npm_version is old (recommended: ${REQUIRED_NPM_VERSION}.x or higher)"
    log_info "Consider updating with: npm install -g npm@latest"
  else
    log_success "npm version: $npm_version"
  fi
}

# Check if we're in the correct directory
validate_project_directory() {
  if [[ ! -f "package.json" ]]; then
    log_error "package.json not found"
    log_error "Please run this script from the root of the Dyad repository"
    exit 1
  fi

  local package_name
  package_name=$(node -p "require('./package.json').name" 2>/dev/null || echo "")

  if [[ "$package_name" != "dyad" ]]; then
    log_error "This doesn't appear to be the Dyad repository"
    exit 1
  fi

  log_success "Running in Dyad project directory"
}

# Create necessary directories
create_directories() {
  log_section "Creating Required Directories"

  local dirs=("userData" "drizzle")

  for dir in "${dirs[@]}"; do
    if [[ -d "$dir" ]]; then
      log_success "Directory already exists: $dir"
    else
      mkdir -p "$dir"
      log_success "Created directory: $dir"
    fi
  done
}

# Install dependencies
install_dependencies() {
  if [[ "$SKIP_DEPS" == true ]]; then
    log_warning "Skipping dependency installation (--skip-deps)"
    return
  fi

  log_section "Installing Dependencies"

  log_info "This may take several minutes..."

  if npm ci --no-audit --no-fund; then
    log_success "Dependencies installed successfully"
  else
    log_error "Failed to install dependencies"
    log_info "Try running: npm ci"
    exit 1
  fi
}

# Setup database
setup_database() {
  if [[ "$SKIP_DB" == true ]]; then
    log_warning "Skipping database setup (--skip-db)"
    return
  fi

  log_section "Setting Up Database"

  # Check if database already exists
  if [[ -f "userData/sqlite.db" ]]; then
    log_warning "Database already exists at userData/sqlite.db"
    read -p "Do you want to regenerate it? This will delete existing data. (y/N) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
      log_info "Skipping database setup"
      return
    fi
    rm -f userData/sqlite.db
  fi

  log_info "Generating database migrations..."
  if npm run db:generate; then
    log_success "Migrations generated"
  else
    log_error "Failed to generate migrations"
    exit 1
  fi

  log_info "Applying database migrations..."
  if npm run db:push; then
    log_success "Database migrations applied"
  else
    log_error "Failed to apply migrations"
    exit 1
  fi
}

# Setup git hooks
setup_git_hooks() {
  if [[ "$SKIP_HOOKS" == true ]]; then
    log_warning "Skipping git hooks setup (--skip-hooks)"
    return
  fi

  log_section "Setting Up Git Hooks"

  if ! command_exists git; then
    log_warning "Git is not installed, skipping hooks setup"
    return
  fi

  if [[ ! -d ".git" ]]; then
    log_warning "Not a git repository, skipping hooks setup"
    return
  fi

  log_info "Installing Husky pre-commit hooks..."
  if npm run init-precommit; then
    log_success "Git hooks configured successfully"
  else
    log_warning "Failed to setup git hooks (non-critical)"
  fi
}

# Create .env file from example if it doesn't exist
setup_env_file() {
  log_section "Setting Up Environment Variables"

  if [[ -f ".env" ]]; then
    log_success ".env file already exists"
  else
    if [[ -f ".env.example" ]]; then
      cp .env.example .env
      log_success "Created .env file from .env.example"
      log_info "Please edit .env and add your API keys and configuration"
    else
      log_warning ".env.example not found, skipping .env creation"
    fi
  fi
}

# Run environment validation
run_validation() {
  log_section "Validating Environment"

  if [[ -f "scripts/validate-environment.js" ]]; then
    log_info "Running environment validation..."
    if node scripts/validate-environment.js; then
      log_success "Environment validation passed"
    else
      log_warning "Environment validation completed with warnings"
    fi
  else
    log_warning "Validation script not found, skipping validation"
  fi
}

# Print next steps
print_next_steps() {
  log_section "Bootstrap Complete!"

  echo ""
  echo -e "${GREEN}${BOLD}🎉 Your Dyad development environment is ready!${NC}"
  echo ""
  echo -e "${CYAN}Next steps:${NC}"
  echo ""
  echo -e "  1. ${BOLD}Configure API keys${NC} (optional for development):"
  echo -e "     Edit ${YELLOW}.env${NC} and add your OpenAI, Anthropic, or other API keys"
  echo ""
  echo -e "  2. ${BOLD}Start development:${NC}"
  echo -e "     ${YELLOW}npm start${NC}"
  echo ""
  echo -e "  3. ${BOLD}Run tests:${NC}"
  echo -e "     ${YELLOW}npm test${NC}              # Unit tests"
  echo -e "     ${YELLOW}npm run pre:e2e${NC}       # Build for E2E tests"
  echo -e "     ${YELLOW}npm run e2e${NC}           # Run E2E tests"
  echo ""
  echo -e "  4. ${BOLD}Build for production:${NC}"
  echo -e "     ${YELLOW}npm run make${NC}          # Create distributable"
  echo ""
  echo -e "${CYAN}Useful commands:${NC}"
  echo -e "  ${YELLOW}npm run lint${NC}            # Run linter"
  echo -e "  ${YELLOW}npm run prettier${NC}        # Format code"
  echo -e "  ${YELLOW}npm run db:studio${NC}       # Open database GUI"
  echo ""
  echo -e "For more information, see ${YELLOW}CONTRIBUTING.md${NC}"
  echo ""
}

# Main execution
main() {
  echo ""
  echo -e "${BOLD}${CYAN}"
  echo "╔═══════════════════════════════════════════════════════════╗"
  echo "║                                                           ║"
  echo "║        Dyad Development Environment Bootstrap            ║"
  echo "║                                                           ║"
  echo "╚═══════════════════════════════════════════════════════════╝"
  echo -e "${NC}"

  validate_node_version
  validate_npm_version
  validate_project_directory
  create_directories
  install_dependencies
  setup_env_file
  setup_database
  setup_git_hooks
  run_validation
  print_next_steps
}

# Run main function
main
