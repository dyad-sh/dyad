#!/usr/bin/env pwsh

<#
.SYNOPSIS
    Dyad Development Environment Bootstrap Script for Windows

.DESCRIPTION
    This script automates the setup of the Dyad development environment on Windows.
    It performs the following tasks:
    - Validates Node.js and npm versions
    - Creates necessary directories
    - Installs dependencies
    - Sets up the database
    - Configures git hooks
    - Validates the environment

.PARAMETER SkipDeps
    Skip dependency installation

.PARAMETER SkipDb
    Skip database setup

.PARAMETER SkipHooks
    Skip git hooks setup

.EXAMPLE
    .\scripts\bootstrap.ps1

.EXAMPLE
    .\scripts\bootstrap.ps1 -SkipDeps -SkipDb

.NOTES
    Requires PowerShell 5.1 or higher
#>

param(
    [switch]$SkipDeps = $false,
    [switch]$SkipDb = $false,
    [switch]$SkipHooks = $false
)

# Stop on errors
$ErrorActionPreference = "Stop"

# Configuration
$REQUIRED_NODE_VERSION = 20
$REQUIRED_NPM_VERSION = 10

# Utility functions
function Write-Info {
    param([string]$Message)
    Write-Host "ℹ " -ForegroundColor Blue -NoNewline
    Write-Host $Message
}

function Write-Success {
    param([string]$Message)
    Write-Host "✓ " -ForegroundColor Green -NoNewline
    Write-Host $Message
}

function Write-Warning {
    param([string]$Message)
    Write-Host "⚠ " -ForegroundColor Yellow -NoNewline
    Write-Host $Message
}

function Write-Error {
    param([string]$Message)
    Write-Host "✗ " -ForegroundColor Red -NoNewline
    Write-Host $Message
}

function Write-Section {
    param([string]$Title)
    Write-Host ""
    Write-Host ("━" * 60) -ForegroundColor Cyan
    Write-Host $Title -ForegroundColor Cyan
    Write-Host ("━" * 60) -ForegroundColor Cyan
}

function Test-Command {
    param([string]$Command)
    try {
        if (Get-Command $Command -ErrorAction Stop) {
            return $true
        }
    }
    catch {
        return $false
    }
}

function Get-MajorVersion {
    param([string]$Version)
    return [int]($Version -replace '^v', '' -split '\.')[0]
}

function Test-NodeVersion {
    Write-Section "Validating Node.js Environment"

    if (-not (Test-Command "node")) {
        Write-Error "Node.js is not installed"
        Write-Info "Please install Node.js $REQUIRED_NODE_VERSION.x or higher"
        Write-Info "Visit: https://nodejs.org/"
        exit 1
    }

    $nodeVersion = node --version
    $nodeMajor = Get-MajorVersion $nodeVersion

    if ($nodeMajor -lt $REQUIRED_NODE_VERSION) {
        Write-Error "Node.js version $nodeVersion is too old"
        Write-Error "Required: Node.js $REQUIRED_NODE_VERSION.x or higher"
        exit 1
    }

    Write-Success "Node.js version: $nodeVersion"
}

function Test-NpmVersion {
    if (-not (Test-Command "npm")) {
        Write-Error "npm is not installed"
        exit 1
    }

    $npmVersion = npm --version
    $npmMajor = Get-MajorVersion $npmVersion

    if ($npmMajor -lt $REQUIRED_NPM_VERSION) {
        Write-Warning "npm version $npmVersion is old (recommended: $REQUIRED_NPM_VERSION.x or higher)"
        Write-Info "Consider updating with: npm install -g npm@latest"
    }
    else {
        Write-Success "npm version: $npmVersion"
    }
}

function Test-ProjectDirectory {
    if (-not (Test-Path "package.json")) {
        Write-Error "package.json not found"
        Write-Error "Please run this script from the root of the Dyad repository"
        exit 1
    }

    try {
        $packageJson = Get-Content "package.json" -Raw | ConvertFrom-Json
        if ($packageJson.name -ne "dyad") {
            Write-Error "This doesn't appear to be the Dyad repository"
            exit 1
        }
    }
    catch {
        Write-Error "Failed to read package.json"
        exit 1
    }

    Write-Success "Running in Dyad project directory"
}

function New-Directories {
    Write-Section "Creating Required Directories"

    $dirs = @("userData", "drizzle")

    foreach ($dir in $dirs) {
        if (Test-Path $dir) {
            Write-Success "Directory already exists: $dir"
        }
        else {
            New-Item -ItemType Directory -Path $dir | Out-Null
            Write-Success "Created directory: $dir"
        }
    }
}

function Install-Dependencies {
    if ($SkipDeps) {
        Write-Warning "Skipping dependency installation (--SkipDeps)"
        return
    }

    Write-Section "Installing Dependencies"
    Write-Info "This may take several minutes..."

    try {
        npm ci --no-audit --no-fund
        Write-Success "Dependencies installed successfully"
    }
    catch {
        Write-Error "Failed to install dependencies"
        Write-Info "Try running: npm ci"
        exit 1
    }
}

function Initialize-Database {
    if ($SkipDb) {
        Write-Warning "Skipping database setup (--SkipDb)"
        return
    }

    Write-Section "Setting Up Database"

    # Check if database already exists
    if (Test-Path "userData\sqlite.db") {
        Write-Warning "Database already exists at userData\sqlite.db"
        $response = Read-Host "Do you want to regenerate it? This will delete existing data. (y/N)"
        if ($response -notmatch '^[Yy]$') {
            Write-Info "Skipping database setup"
            return
        }
        Remove-Item "userData\sqlite.db" -Force
    }

    Write-Info "Generating database migrations..."
    try {
        npm run db:generate
        Write-Success "Migrations generated"
    }
    catch {
        Write-Error "Failed to generate migrations"
        exit 1
    }

    Write-Info "Applying database migrations..."
    try {
        npm run db:push
        Write-Success "Database migrations applied"
    }
    catch {
        Write-Error "Failed to apply migrations"
        exit 1
    }
}

function Initialize-GitHooks {
    if ($SkipHooks) {
        Write-Warning "Skipping git hooks setup (--SkipHooks)"
        return
    }

    Write-Section "Setting Up Git Hooks"

    if (-not (Test-Command "git")) {
        Write-Warning "Git is not installed, skipping hooks setup"
        return
    }

    if (-not (Test-Path ".git")) {
        Write-Warning "Not a git repository, skipping hooks setup"
        return
    }

    Write-Info "Installing Husky pre-commit hooks..."
    try {
        npm run init-precommit
        Write-Success "Git hooks configured successfully"
    }
    catch {
        Write-Warning "Failed to setup git hooks (non-critical)"
    }
}

function Initialize-EnvFile {
    Write-Section "Setting Up Environment Variables"

    if (Test-Path ".env") {
        Write-Success ".env file already exists"
    }
    else {
        if (Test-Path ".env.example") {
            Copy-Item ".env.example" ".env"
            Write-Success "Created .env file from .env.example"
            Write-Info "Please edit .env and add your API keys and configuration"
        }
        else {
            Write-Warning ".env.example not found, skipping .env creation"
        }
    }
}

function Invoke-Validation {
    Write-Section "Validating Environment"

    if (Test-Path "scripts\validate-environment.js") {
        Write-Info "Running environment validation..."
        try {
            node scripts\validate-environment.js
            Write-Success "Environment validation passed"
        }
        catch {
            Write-Warning "Environment validation completed with warnings"
        }
    }
    else {
        Write-Warning "Validation script not found, skipping validation"
    }
}

function Show-NextSteps {
    Write-Section "Bootstrap Complete!"

    Write-Host ""
    Write-Host "🎉 Your Dyad development environment is ready!" -ForegroundColor Green
    Write-Host ""
    Write-Host "Next steps:" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "  1. " -NoNewline
    Write-Host "Configure API keys" -NoNewline
    Write-Host " (optional for development):"
    Write-Host "     Edit " -NoNewline
    Write-Host ".env" -ForegroundColor Yellow -NoNewline
    Write-Host " and add your OpenAI, Anthropic, or other API keys"
    Write-Host ""
    Write-Host "  2. " -NoNewline
    Write-Host "Start development:"
    Write-Host "     " -NoNewline
    Write-Host "npm start" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "  3. " -NoNewline
    Write-Host "Run tests:"
    Write-Host "     " -NoNewline
    Write-Host "npm test" -ForegroundColor Yellow -NoNewline
    Write-Host "              # Unit tests"
    Write-Host "     " -NoNewline
    Write-Host "npm run pre:e2e" -ForegroundColor Yellow -NoNewline
    Write-Host "       # Build for E2E tests"
    Write-Host "     " -NoNewline
    Write-Host "npm run e2e" -ForegroundColor Yellow -NoNewline
    Write-Host "           # Run E2E tests"
    Write-Host ""
    Write-Host "  4. " -NoNewline
    Write-Host "Build for production:"
    Write-Host "     " -NoNewline
    Write-Host "npm run make" -ForegroundColor Yellow -NoNewline
    Write-Host "          # Create distributable"
    Write-Host ""
    Write-Host "Useful commands:" -ForegroundColor Cyan
    Write-Host "  " -NoNewline
    Write-Host "npm run lint" -ForegroundColor Yellow -NoNewline
    Write-Host "            # Run linter"
    Write-Host "  " -NoNewline
    Write-Host "npm run prettier" -ForegroundColor Yellow -NoNewline
    Write-Host "        # Format code"
    Write-Host "  " -NoNewline
    Write-Host "npm run db:studio" -ForegroundColor Yellow -NoNewline
    Write-Host "       # Open database GUI"
    Write-Host ""
    Write-Host "For more information, see " -NoNewline
    Write-Host "CONTRIBUTING.md" -ForegroundColor Yellow
    Write-Host ""
}

function Main {
    Write-Host ""
    Write-Host "╔═══════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
    Write-Host "║                                                           ║" -ForegroundColor Cyan
    Write-Host "║        Dyad Development Environment Bootstrap            ║" -ForegroundColor Cyan
    Write-Host "║                                                           ║" -ForegroundColor Cyan
    Write-Host "╚═══════════════════════════════════════════════════════════╝" -ForegroundColor Cyan
    Write-Host ""

    Test-NodeVersion
    Test-NpmVersion
    Test-ProjectDirectory
    New-Directories
    Install-Dependencies
    Initialize-EnvFile
    Initialize-Database
    Initialize-GitHooks
    Invoke-Validation
    Show-NextSteps
}

# Run main function
try {
    Main
}
catch {
    Write-Host ""
    Write-Error "Bootstrap script encountered an error:"
    Write-Host $_.Exception.Message -ForegroundColor Red
    Write-Host $_.ScriptStackTrace -ForegroundColor Red
    exit 1
}
