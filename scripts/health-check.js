#!/usr/bin/env node
/**
 * Dyad Health Check Script
 *
 * Performs comprehensive health checks on the Dyad application.
 * This script can be run before starting development or as part of CI/CD.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

let exitCode = 0;

// Check TypeScript compilation
function checkTypeScript() {
  log('\n📘 Checking TypeScript compilation...', 'cyan');
  try {
    execSync('npm run ts', { stdio: 'inherit' });
    log('✓ TypeScript compilation passed', 'green');
  } catch (error) {
    log('✗ TypeScript compilation failed', 'red');
    exitCode = 1;
  }
}

// Check linting
function checkLinting() {
  log('\n🔍 Checking code quality (linting)...', 'cyan');
  try {
    execSync('npm run lint', { stdio: 'inherit' });
    log('✓ Linting passed', 'green');
  } catch (error) {
    log('✗ Linting failed', 'red');
    exitCode = 1;
  }
}

// Check formatting
function checkFormatting() {
  log('\n💅 Checking code formatting...', 'cyan');
  try {
    execSync('npm run prettier:check', { stdio: 'inherit' });
    log('✓ Code formatting is correct', 'green');
  } catch (error) {
    log('✗ Code formatting issues found', 'red');
    log('  Run: npm run prettier', 'yellow');
    exitCode = 1;
  }
}

// Run unit tests
function runUnitTests() {
  log('\n🧪 Running unit tests...', 'cyan');
  try {
    execSync('npm test', { stdio: 'inherit' });
    log('✓ All unit tests passed', 'green');
  } catch (error) {
    log('✗ Some unit tests failed', 'red');
    exitCode = 1;
  }
}

// Check database
function checkDatabase() {
  log('\n🗄️  Checking database...', 'cyan');
  const dbPath = path.join(process.cwd(), 'userData', 'sqlite.db');

  if (!fs.existsSync(dbPath)) {
    log('✗ Database not found at userData/sqlite.db', 'red');
    log('  Run: npm run db:generate && npm run db:push', 'yellow');
    exitCode = 1;
  } else {
    const stats = fs.statSync(dbPath);
    log(`✓ Database found (${(stats.size / 1024).toFixed(2)} KB)`, 'green');
  }
}

// Check for common issues
function checkCommonIssues() {
  log('\n🔎 Checking for common issues...', 'cyan');

  // Check for lock file
  if (!fs.existsSync('package-lock.json')) {
    log('⚠ package-lock.json not found', 'yellow');
    log('  Run: npm install', 'yellow');
  } else {
    log('✓ package-lock.json exists', 'green');
  }

  // Check for node_modules
  if (!fs.existsSync('node_modules')) {
    log('✗ node_modules not found', 'red');
    log('  Run: npm install', 'yellow');
    exitCode = 1;
  } else {
    log('✓ node_modules exists', 'green');
  }

  // Check for .env file
  if (!fs.existsSync('.env')) {
    log('⚠ .env file not found (optional but recommended)', 'yellow');
    log('  Copy .env.example to .env and configure your API keys', 'yellow');
  } else {
    log('✓ .env file exists', 'green');
  }
}

// Main function
function main() {
  const args = process.argv.slice(2);
  const runAll = args.length === 0 || args.includes('--all');
  const quick = args.includes('--quick');

  log('╔═══════════════════════════════════════════════╗', 'cyan');
  log('║         Dyad Health Check                    ║', 'cyan');
  log('╚═══════════════════════════════════════════════╝', 'cyan');

  if (args.includes('--help')) {
    console.log(`
Usage: node scripts/health-check.js [options]

Options:
  --all       Run all checks (default)
  --quick     Run only fast checks (skip tests)
  --ts        Check TypeScript compilation only
  --lint      Check linting only
  --format    Check formatting only
  --test      Run unit tests only
  --db        Check database only
  --help      Show this help message

Examples:
  node scripts/health-check.js              # Run all checks
  node scripts/health-check.js --quick      # Fast checks only
  node scripts/health-check.js --ts --lint  # TypeScript and linting only
`);
    return;
  }

  checkCommonIssues();
  checkDatabase();

  if (runAll || args.includes('--ts')) {
    checkTypeScript();
  }

  if (runAll || args.includes('--lint')) {
    checkLinting();
  }

  if (runAll || args.includes('--format')) {
    checkFormatting();
  }

  if (!quick && (runAll || args.includes('--test'))) {
    runUnitTests();
  }

  log('\n' + '═'.repeat(50), 'cyan');
  if (exitCode === 0) {
    log('✅ All health checks passed!', 'green');
  } else {
    log('❌ Some health checks failed', 'red');
    log('Please fix the issues above before proceeding', 'yellow');
  }
  log('═'.repeat(50) + '\n', 'cyan');

  process.exit(exitCode);
}

main();
