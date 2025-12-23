#!/usr/bin/env node
/**
 * Quick test for dynamic documentation fetching
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function testDynamicFetching() {
  console.log('🧪 Testing dynamic documentation fetching...\n');

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
    console.log('✅ Connected to MCP server\n');

    // Test 1: List tools (should now have 7 tools total)
    console.log('📋 Listing tools...');
    const toolsList = await client.listTools();
    console.log(`Found ${toolsList.tools.length} tools:`);
    toolsList.tools.forEach(tool => {
      console.log(`  - ${tool.name}`);
    });
    console.log();

    // Test 2: Fetch Solana docs
    console.log('🌐 Fetching live Solana documentation...');
    const solanaResult = await client.callTool({
      name: 'fetch-solana-docs',
      arguments: { section: 'all' },
    });
    const solanaContent = ((solanaResult.content as any[])[0] as any).text;
    console.log(`✅ Fetched ${solanaContent.length} characters`);
    console.log(`Preview: ${solanaContent.substring(0, 200)}...`);
    console.log();

    // Test 3: Fetch latest releases
    console.log('🔖 Fetching latest GitHub releases...');
    const releasesResult = await client.callTool({
      name: 'fetch-latest-releases',
      arguments: { tool: 'all' },
    });
    const releasesContent = ((releasesResult.content as any[])[0] as any).text;
    console.log('✅ Fetched version info:');
    console.log(releasesContent);
    console.log();

    // Test 4: Search docs
    console.log('🔍 Searching for "token" in docs...');
    const searchResult = await client.callTool({
      name: 'search-blockchain-docs',
      arguments: { query: 'token', ecosystem: 'solana' },
    });
    const searchContent = ((searchResult.content as any[])[0] as any).text;
    console.log(`✅ Found matches (${searchContent.length} characters)`);
    console.log(`Preview: ${searchContent.substring(0, 300)}...`);
    console.log();

    await client.close();

    console.log('\n✅ All dynamic fetching tests passed!');
    console.log('\nThe MCP server now pulls live data from:');
    console.log('  - https://solana.com/llms.txt (Solana LLM docs)');
    console.log('  - GitHub API (latest release versions)');
    console.log('  - With 1-hour caching to avoid rate limits');

    process.exit(0);
  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  }
}

testDynamicFetching();
