#!/usr/bin/env node
/**
 * Test suite for blockchain-guide MCP server v2.0
 * Tests the 4 essential tools
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Test utilities
let testsRun = 0;
let testsPassed = 0;
let testsFailed = 0;

function assert(condition: boolean, message: string) {
  testsRun++;
  if (condition) {
    testsPassed++;
    console.log(`  ✓ ${message}`);
  } else {
    testsFailed++;
    console.error(`  ✗ ${message}`);
    throw new Error(`Assertion failed: ${message}`);
  }
}

async function test(name: string, fn: () => Promise<void>) {
  console.log(`\n${name}`);
  try {
    await fn();
  } catch (error) {
    console.error(`  Error: ${error}`);
    throw error;
  }
}

// Main test suite
async function runTests() {
  console.log('🧪 Running blockchain-guide MCP server v2.0 tests...\n');

  let client: Client | undefined;

  try {
    // Setup
    const transport = new StdioClientTransport({
      command: 'node',
      args: [path.join(__dirname, 'dist', 'index.js')],
    });

    client = new Client(
      { name: 'test-client', version: '1.0.0' },
      { capabilities: {} }
    );

    await client.connect(transport);

    // Test 1: Server Connection
    await test('✓ Server Connection', async () => {
      assert(client !== undefined, 'Client connected successfully');
    });

    // Test 2: List Tools
    await test('✓ List Tools', async () => {
      const result = await client!.listTools();
      assert(result.tools.length === 4, `Expected 4 tools, got ${result.tools.length}`);

      const toolNames = result.tools.map(t => t.name);
      assert(toolNames.includes('fetch-ecosystem-docs'), 'Has fetch-ecosystem-docs tool');
      assert(toolNames.includes('fetch-latest-releases'), 'Has fetch-latest-releases tool');
      assert(toolNames.includes('get-translation-guide'), 'Has get-translation-guide tool');
      assert(toolNames.includes('check-feature-compatibility'), 'Has check-feature-compatibility tool');

      result.tools.forEach(tool => {
        assert(!!tool.description && tool.description.length > 0, `Tool ${tool.name} has description`);
      });
    });

    // Test 3: fetch-ecosystem-docs
    await test('✓ fetch-ecosystem-docs Tool', async () => {
      // Test Solana docs
      const solanaResult = await client!.callTool({
        name: 'fetch-ecosystem-docs',
        arguments: { ecosystem: 'solana' },
      });
      const solanaText = ((solanaResult.content as any[])[0] as any).text;
      assert(solanaText.includes('Solana'), 'Solana docs contain "Solana"');
      assert(solanaText.length > 10000, 'Solana docs are substantial (>10KB)');

      // Test Anchor docs
      const anchorResult = await client!.callTool({
        name: 'fetch-ecosystem-docs',
        arguments: { ecosystem: 'anchor' },
      });
      const anchorText = ((anchorResult.content as any[])[0] as any).text;
      assert(anchorText.includes('Anchor'), 'Anchor docs mention Anchor');

      // Test Sui docs
      const suiResult = await client!.callTool({
        name: 'fetch-ecosystem-docs',
        arguments: { ecosystem: 'sui' },
      });
      const suiText = ((suiResult.content as any[])[0] as any).text;
      assert(suiText.includes('Sui'), 'Sui docs mention Sui');
    });

    // Test 4: fetch-latest-releases
    await test('✓ fetch-latest-releases Tool', async () => {
      // Test single ecosystem
      const anchorResult = await client!.callTool({
        name: 'fetch-latest-releases',
        arguments: { ecosystem: 'anchor' },
      });
      const anchorText = ((anchorResult.content as any[])[0] as any).text;
      assert(anchorText.includes('ANCHOR'), 'Contains ANCHOR');
      assert(anchorText.includes('Release URL'), 'Contains Release URL');

      // Test all ecosystems
      const allResult = await client!.callTool({
        name: 'fetch-latest-releases',
        arguments: { ecosystem: 'all' },
      });
      const allText = ((allResult.content as any[])[0] as any).text;
      assert(allText.includes('ANCHOR'), 'All results contain ANCHOR');
      assert(allText.includes('SOLANA'), 'All results contain SOLANA');
      assert(allText.includes('SUI'), 'All results contain SUI');
    });

    // Test 5: get-translation-guide
    await test('✓ get-translation-guide Tool', async () => {
      // Test Solidity to Solana
      const solanaGuide = await client!.callTool({
        name: 'get-translation-guide',
        arguments: { from: 'solidity', to: 'solana' },
      });
      const solanaText = ((solanaGuide.content as any[])[0] as any).text;
      assert(solanaText.includes('Solidity'), 'Guide mentions Solidity');
      assert(solanaText.includes('Solana'), 'Guide mentions Solana');
      assert(solanaText.includes('PDA'), 'Guide mentions PDAs');
      assert(solanaText.includes('Account'), 'Guide mentions Account');

      // Test Solidity to Sui
      const suiGuide = await client!.callTool({
        name: 'get-translation-guide',
        arguments: { from: 'solidity', to: 'sui' },
      });
      const suiText = ((suiGuide.content as any[])[0] as any).text;
      assert(suiText.includes('Solidity'), 'Guide mentions Solidity');
      assert(suiText.includes('Sui'), 'Guide mentions Sui');
      assert(suiText.includes('Object'), 'Guide mentions Objects');
    });

    // Test 6: check-feature-compatibility
    await test('✓ check-feature-compatibility Tool', async () => {
      // Test mapping feature
      const mappingResult = await client!.callTool({
        name: 'check-feature-compatibility',
        arguments: { feature: 'mapping', target: 'solana' },
      });
      const mappingText = ((mappingResult.content as any[])[0] as any).text;
      assert(mappingText.includes('mapping'), 'Result mentions mapping');
      assert(mappingText.includes('PDA'), 'Solana mapping uses PDAs');

      // Test modifier feature
      const modifierResult = await client!.callTool({
        name: 'check-feature-compatibility',
        arguments: { feature: 'modifier', target: 'sui' },
      });
      const modifierText = ((modifierResult.content as any[])[0] as any).text;
      assert(modifierText.includes('capability'), 'Sui uses capabilities');

      // Test event feature
      const eventResult = await client!.callTool({
        name: 'check-feature-compatibility',
        arguments: { feature: 'event', target: 'solana' },
      });
      const eventText = ((eventResult.content as any[])[0] as any).text;
      assert(eventText.includes('emit'), 'Mentions emit');
    });

    // Cleanup
    await client?.close();

    // Summary
    console.log('\n' + '='.repeat(60));
    console.log('📊 Test Summary');
    console.log('='.repeat(60));
    console.log(`Total tests run: ${testsRun}`);
    console.log(`Tests passed: ${testsPassed}`);
    console.log(`Tests failed: ${testsFailed}`);

    if (testsFailed === 0) {
      console.log('\n✅ All tests passed!');
      process.exit(0);
    } else {
      console.error('\n❌ Some tests failed');
      process.exit(1);
    }

  } catch (error) {
    console.error('\n❌ Test suite failed:', error);
    await client?.close();
    process.exit(1);
  }
}

runTests();
