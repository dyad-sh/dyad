#!/usr/bin/env node
/**
 * Environment Validation Script for Dyad
 *
 * This script validates that the development environment meets all requirements
 * for building and running Dyad.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const REQUIRED_NODE_VERSION = 20;
const REQUIRED_NPM_VERSION = 10;

// ANSI color codes for terminal output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function logSection(title) {
  console.log('\n' + '='.repeat(60));
  log(title, 'cyan');
  console.log('='.repeat(60));
}

function checkMark(success) {
  return success ? '✓' : '✗';
}

function exec(command, options = {}) {
  try {
    return execSync(command, {
      encoding: 'utf-8',
      stdio: options.silent ? 'pipe' : 'inherit',
      ...options,
    }).trim();
  } catch (error) {
    if (options.ignoreError) {
      return null;
    }
    throw error;
  }
}

const checks = {
  passed: 0,
  failed: 0,
  warnings: 0,
};

function recordCheck(passed, message, level = 'error') {
  const symbol = checkMark(passed);
  const color = passed ? 'green' : level === 'warning' ? 'yellow' : 'red';

  if (passed) {
    checks.passed++;
  } else {
    if (level === 'warning') {
      checks.warnings++;
    } else {
      checks.failed++;
    }
  }

  log(`  ${symbol} ${message}`, color);
  return passed;
}

// Validation checks
async function validateNodeVersion() {
  logSection('Node.js Environment');

  const nodeVersion = process.version;
  const majorVersion = parseInt(nodeVersion.slice(1).split('.')[0]);

  recordCheck(
    majorVersion >= REQUIRED_NODE_VERSION,
    `Node.js version ${nodeVersion} (requires >= ${REQUIRED_NODE_VERSION}.x)`
  );

  // Check npm version
  try {
    const npmVersion = exec('npm --version', { silent: true });
    const npmMajor = parseInt(npmVersion.split('.')[0]);
    recordCheck(
      npmMajor >= REQUIRED_NPM_VERSION,
      `npm version ${npmVersion} (requires >= ${REQUIRED_NPM_VERSION}.x)`
    );
  } catch (error) {
    recordCheck(false, 'npm is not installed or not in PATH');
  }
}

function validateGit() {
  logSection('Git Configuration');

  try {
    const gitVersion = exec('git --version', { silent: true });
    recordCheck(true, `Git is installed: ${gitVersion}`);

    // Check if we're in a git repository
    const isGitRepo = fs.existsSync(path.join(process.cwd(), '.git'));
    recordCheck(isGitRepo, 'Current directory is a git repository');

    if (isGitRepo) {
      try {
        const userName = exec('git config user.name', { silent: true, ignoreError: true });
        const userEmail = exec('git config user.email', { silent: true, ignoreError: true });

        recordCheck(!!userName, `Git user.name is configured: ${userName || 'NOT SET'}`, 'warning');
        recordCheck(!!userEmail, `Git user.email is configured: ${userEmail || 'NOT SET'}`, 'warning');
      } catch (error) {
        recordCheck(false, 'Unable to read git config', 'warning');
      }
    }
  } catch (error) {
    recordCheck(false, 'Git is not installed or not in PATH');
  }
}

function validateDirectories() {
  logSection('Project Structure');

  const requiredDirs = [
    'src',
    'workers',
    'scripts',
    'e2e-tests',
    'testing',
    'scaffold',
  ];

  requiredDirs.forEach((dir) => {
    const exists = fs.existsSync(path.join(process.cwd(), dir));
    recordCheck(exists, `Directory exists: ${dir}`);
  });

  // Check for userData directory
  const userDataExists = fs.existsSync(path.join(process.cwd(), 'userData'));
  recordCheck(userDataExists, 'userData directory exists (required for database)', 'warning');
}

function validateFiles() {
  logSection('Required Files');

  const requiredFiles = [
    'package.json',
    'package-lock.json',
    'tsconfig.json',
    'forge.config.ts',
    'drizzle.config.ts',
  ];

  requiredFiles.forEach((file) => {
    const exists = fs.existsSync(path.join(process.cwd(), file));
    recordCheck(exists, `File exists: ${file}`);
  });

  // Check for .env file (optional but recommended for development)
  const envExists = fs.existsSync(path.join(process.cwd(), '.env'));
  recordCheck(
    envExists,
    '.env file exists (optional but recommended for API keys)',
    'warning'
  );
}

function validateDependencies() {
  logSection('Dependencies');

  const nodeModulesExists = fs.existsSync(path.join(process.cwd(), 'node_modules'));
  recordCheck(nodeModulesExists, 'node_modules directory exists');

  if (nodeModulesExists) {
    // Check for critical dependencies
    const criticalDeps = ['electron', 'react', 'vite', 'drizzle-orm'];

    criticalDeps.forEach((dep) => {
      const depPath = path.join(process.cwd(), 'node_modules', dep);
      const exists = fs.existsSync(depPath);
      recordCheck(exists, `Critical dependency installed: ${dep}`);
    });
  }
}

function validatePlatformTools() {
  logSection('Platform-Specific Tools');

  const platform = os.platform();
  log(`  Operating System: ${platform}`, 'blue');

  // Check for platform-specific build tools
  if (platform === 'darwin') {
    // macOS
    try {
      exec('xcode-select -p', { silent: true });
      recordCheck(true, 'Xcode Command Line Tools installed');
    } catch {
      recordCheck(false, 'Xcode Command Line Tools not installed', 'warning');
      log('    Install with: xcode-select --install', 'yellow');
    }
  } else if (platform === 'win32') {
    // Windows
    try {
      exec('where python', { silent: true });
      recordCheck(true, 'Python is installed (required for node-gyp)');
    } catch {
      recordCheck(false, 'Python not found in PATH', 'warning');
    }
  }
}

function validateDatabase() {
  logSection('Database Configuration');

  const drizzleDir = path.join(process.cwd(), 'drizzle');
  const drizzleExists = fs.existsSync(drizzleDir);
  recordCheck(drizzleExists, 'Drizzle migrations directory exists', 'warning');

  const dbPath = path.join(process.cwd(), 'userData', 'sqlite.db');
  const dbExists = fs.existsSync(dbPath);
  recordCheck(dbExists, 'SQLite database file exists', 'warning');

  if (!dbExists) {
    log('    Run migrations with: npm run db:generate && npm run db:push', 'yellow');
  }
}

function validateOptionalTools() {
  logSection('Optional Development Tools');

  // Check for pnpm (used in E2E tests)
  try {
    const pnpmVersion = exec('pnpm --version', { silent: true });
    recordCheck(true, `pnpm is installed: ${pnpmVersion} (required for E2E tests)`);
  } catch {
    recordCheck(false, 'pnpm is not installed (required for E2E tests)', 'warning');
    log('    Install with: npm install -g pnpm', 'yellow');
  }

  // Check for Playwright browsers
  try {
    const playwrightInstalled = fs.existsSync(
      path.join(os.homedir(), '.cache', 'ms-playwright')
    ) || fs.existsSync(
      path.join(os.homedir(), 'Library', 'Caches', 'ms-playwright')
    );
    recordCheck(
      playwrightInstalled,
      'Playwright browsers installed',
      'warning'
    );
    if (!playwrightInstalled) {
      log('    Install with: npx playwright install chromium --with-deps', 'yellow');
    }
  } catch {
    recordCheck(false, 'Unable to check Playwright installation', 'warning');
  }
}

function printSummary() {
  logSection('Validation Summary');

  const total = checks.passed + checks.failed + checks.warnings;

  log(`  Total checks: ${total}`, 'blue');
  log(`  ✓ Passed: ${checks.passed}`, 'green');

  if (checks.warnings > 0) {
    log(`  ⚠ Warnings: ${checks.warnings}`, 'yellow');
  }

  if (checks.failed > 0) {
    log(`  ✗ Failed: ${checks.failed}`, 'red');
  }

  console.log('\n');

  if (checks.failed > 0) {
    log('❌ Environment validation FAILED', 'red');
    log('Please fix the errors above before proceeding.', 'red');
    process.exit(1);
  } else if (checks.warnings > 0) {
    log('⚠️  Environment validation passed with WARNINGS', 'yellow');
    log('Some optional features may not work correctly.', 'yellow');
    process.exit(0);
  } else {
    log('✅ Environment validation PASSED', 'green');
    log('Your environment is ready for Dyad development!', 'green');
    process.exit(0);
  }
}

// Main execution
async function main() {
  console.log('\n');
  log('🔍 Dyad Development Environment Validator', 'bright');
  log('This script will check if your environment is ready for development.\n', 'blue');

  await validateNodeVersion();
  validateGit();
  validateDirectories();
  validateFiles();
  validateDependencies();
  validatePlatformTools();
  validateDatabase();
  validateOptionalTools();
  printSummary();
}

main().catch((error) => {
  console.error('\n');
  log('❌ Validation script encountered an error:', 'red');
  console.error(error);
  process.exit(1);
});
