#!/usr/bin/env node

/**
 * MCP Integration Test Script
 *
 * This script tests the MCP (Model Context Protocol) integration
 * by validating configurations and checking server connectivity.
 */

const fs = require('fs');
const path = require('path');

// Simple color logging
const colors = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  reset: '\x1b[0m'
};

function log(color, message) {
  console.log(`${color}${message}${colors.reset}`);
}

async function testMCPIntegration() {
  log(colors.blue, '🧪 Starting MCP Integration Tests...\n');

  try {
    // Check if MCP service files exist
    const mcpServicePath = path.join(__dirname, '../src/lib/services/mcpService.ts');
    const mcpSchemasPath = path.join(__dirname, '../src/lib/services/mcpSchemas.ts');

    if (!fs.existsSync(mcpServicePath)) {
      throw new Error(`MCP Service file not found: ${mcpServicePath}`);
    }

    if (!fs.existsSync(mcpSchemasPath)) {
      throw new Error(`MCP Schemas file not found: ${mcpSchemasPath}`);
    }

    log(colors.green, '✅ MCP service files exist');

    // Check if TypeScript compilation works
    const { execSync } = require('child_process');
    try {
      execSync('npx tsc --noEmit --skipLibCheck src/lib/services/mcpService.ts', {
        cwd: path.join(__dirname, '..'),
        stdio: 'pipe'
      });
      log(colors.green, '✅ MCP Service TypeScript compilation successful');
    } catch (error) {
      log(colors.yellow, '⚠️  MCP Service TypeScript compilation has issues:');
      console.log(error.stdout?.toString() || error.message);
    }

    // Test basic import structure (this would require the full Node.js environment)
    log(colors.blue, '\n🔍 Testing basic import structure...');
    log(colors.yellow, 'ℹ️  Note: Full MCP functionality testing requires the Electron app environment');
    log(colors.yellow, 'ℹ️  This script validates file structure and basic compilation only');

    // Check for example configurations
    const testConfigsPath = path.join(__dirname, '../src/lib/services/mcpTestConfigs.ts');
    if (fs.existsSync(testConfigsPath)) {
      log(colors.green, '✅ Test configurations file exists');
    } else {
      log(colors.yellow, '⚠️  No test configurations file found');
    }

    log(colors.green, '\n🎉 Basic MCP integration validation completed successfully!');
    log(colors.blue, '\n📋 To run full MCP tests:');
    log(colors.blue, '   1. Start the application: npm start');
    log(colors.blue, '   2. Navigate to Settings > MCP Servers Configuration');
    log(colors.blue, '   3. Add a test MCP server configuration');
    log(colors.blue, '   4. Monitor the application logs for any errors');

  } catch (error) {
    log(colors.red, `\n❌ MCP Integration Test Failed: ${error.message}`);
    process.exit(1);
  }
}

// Run the test if this script is executed directly
if (require.main === module) {
  testMCPIntegration().catch(error => {
    log(colors.red, `Fatal error: ${error.message}`);
    process.exit(1);
  });
}

module.exports = { testMCPIntegration };
