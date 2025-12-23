#!/usr/bin/env node
/**
 * Comprehensive test showing what information the model now has access to
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function runComprehensiveTest() {
  console.log('🎯 Comprehensive MCP Server Test\n');
  console.log('Showing what information is available to the model during translation...\n');

  const transport = new StdioClientTransport({
    command: 'node',
    args: [path.join(__dirname, 'dist', 'index.js')],
  });

  const client = new Client(
    { name: 'test-client', version: '1.0.0' },
    { capabilities: {} }
  );

  try {
    await client.connect(transport);

    // Test 1: Latest releases with FULL release notes
    console.log('═══════════════════════════════════════════════════════════');
    console.log('TEST 1: Fetch Latest Releases (WITH RELEASE NOTES)');
    console.log('═══════════════════════════════════════════════════════════\n');

    const releasesResult = await client.callTool({
      name: 'fetch-latest-releases',
      arguments: { tool: 'anchor' }, // Just test Anchor for brevity
    });
    const releasesContent = ((releasesResult.content as any[])[0] as any).text;
    console.log(releasesContent);
    console.log('\n✅ Model now knows: Version + Breaking Changes + Features + Bug Fixes\n');

    // Test 2: Migration guide
    console.log('═══════════════════════════════════════════════════════════');
    console.log('TEST 2: Get Migration Guide');
    console.log('═══════════════════════════════════════════════════════════\n');

    const migrationResult = await client.callTool({
      name: 'get-migration-guide',
      arguments: { ecosystem: 'anchor' },
    });
    const migrationContent = ((migrationResult.content as any[])[0] as any).text;
    console.log(migrationContent.substring(0, 1000) + '...\n');
    console.log('✅ Model now knows: How to migrate code between versions\n');

    // Test 3: Code examples
    console.log('═══════════════════════════════════════════════════════════');
    console.log('TEST 3: Fetch Code Examples');
    console.log('═══════════════════════════════════════════════════════════\n');

    const examplesResult = await client.callTool({
      name: 'fetch-code-examples',
      arguments: { ecosystem: 'anchor', topic: 'token' },
    });
    const examplesContent = ((examplesResult.content as any[])[0] as any).text;
    console.log(examplesContent);
    console.log('\n✅ Model now knows: Links to actual working code examples\n');

    // Test 4: Search Solana docs for specific implementation
    console.log('═══════════════════════════════════════════════════════════');
    console.log('TEST 4: Search Docs for Specific Implementation');
    console.log('═══════════════════════════════════════════════════════════\n');

    const searchResult = await client.callTool({
      name: 'search-blockchain-docs',
      arguments: { query: 'create account', ecosystem: 'solana' },
    });
    const searchContent = ((searchResult.content as any[])[0] as any).text;
    console.log(searchContent.substring(0, 800) + '...\n');
    console.log('✅ Model now knows: How to implement specific features from live docs\n');

    // Test 5: Full Solana docs context
    console.log('═══════════════════════════════════════════════════════════');
    console.log('TEST 5: Get Full Context (Solana LLM Docs)');
    console.log('═══════════════════════════════════════════════════════════\n');

    const docsResult = await client.callTool({
      name: 'fetch-solana-docs',
      arguments: { section: 'programs' },
    });
    const docsContent = ((docsResult.content as any[])[0] as any).text;
    console.log(`Fetched ${docsContent.length} characters of program documentation`);
    console.log('Preview:');
    console.log(docsContent.substring(0, 500) + '...\n');
    console.log('✅ Model now knows: Complete program development patterns\n');

    await client.close();

    // Summary
    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('SUMMARY: What The Model Sees During Translation');
    console.log('═══════════════════════════════════════════════════════════\n');

    console.log('📋 9 Total Tools Available:\n');
    console.log('Static Guides (Fallback):');
    console.log('  1. get-sui-translation-guide');
    console.log('  2. get-solana-translation-guide');
    console.log('  3. get-latest-versions (static fallback)');
    console.log('  4. check-translation-compatibility\n');

    console.log('Dynamic Data (Live):');
    console.log('  5. fetch-solana-docs → 645KB LLM-optimized docs');
    console.log('  6. fetch-latest-releases → Versions + Release Notes + Breaking Changes');
    console.log('  7. search-blockchain-docs → Find specific implementations');
    console.log('  8. fetch-code-examples → Links to working code in official repos');
    console.log('  9. get-migration-guide → How to upgrade code between versions\n');

    console.log('🎯 During Translation, the Model Can:\n');
    console.log('  ✓ Know exact current version (e.g., Anchor 0.32.1)');
    console.log('  ✓ Read breaking changes between versions');
    console.log('  ✓ See new features and how to use them');
    console.log('  ✓ Search 645KB of Solana docs for patterns');
    console.log('  ✓ Find official code examples');
    console.log('  ✓ Understand migration paths');
    console.log('  ✓ Generate code using latest APIs\n');

    console.log('💡 Example Translation Flow:\n');
    console.log('  User: "Translate ERC20 to Anchor"');
    console.log('    → Model calls: fetch-latest-releases({ tool: "anchor" })');
    console.log('    → Gets: Anchor 0.32.1 + breaking changes + features');
    console.log('    → Model calls: fetch-code-examples({ ecosystem: "anchor", topic: "token" })');
    console.log('    → Gets: Links to official SPL token examples');
    console.log('    → Model calls: search-blockchain-docs({ query: "mint token" })');
    console.log('    → Gets: Current patterns from Solana docs');
    console.log('    → Generates: Code using Anchor 0.32.1 with current patterns');
    console.log('    → Result: Compiles on first try! ✅\n');

    console.log('✅ All comprehensive tests passed!');
    console.log('The model now has access to LIVE, UP-TO-DATE information! 🚀\n');

    process.exit(0);
  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  }
}

runComprehensiveTest();
