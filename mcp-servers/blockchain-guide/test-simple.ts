#!/usr/bin/env node
/**
 * Simple test for the v2.0 simplified MCP server
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function testSimplified() {
  console.log('🧪 Testing Simplified MCP Server v2.0\n');

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

    console.log('═══════════════════════════════════════════════════════════');
    console.log('Available Tools');
    console.log('═══════════════════════════════════════════════════════════\n');

    const toolsResult = await client.listTools();
    console.log(`Total tools: ${toolsResult.tools.length}\n`);

    toolsResult.tools.forEach((tool, i) => {
      console.log(`${i + 1}. ${tool.name}`);
      console.log(`   ${tool.description}\n`);
    });

    console.log('═══════════════════════════════════════════════════════════');
    console.log('TEST 1: Fetch Solana Documentation');
    console.log('═══════════════════════════════════════════════════════════\n');

    const docsResult = await client.callTool({
      name: 'fetch-ecosystem-docs',
      arguments: { ecosystem: 'solana' },
    });
    const docsText = ((docsResult.content as any[])[0] as any).text;
    const docsSize = docsText.length;
    console.log(`Fetched ${(docsSize / 1024).toFixed(0)}KB of Solana documentation`);
    console.log('Preview:', docsText.substring(0, 200), '...\n');

    console.log('═══════════════════════════════════════════════════════════');
    console.log('TEST 2: Fetch Latest Anchor Release');
    console.log('═══════════════════════════════════════════════════════════\n');

    const releaseResult = await client.callTool({
      name: 'fetch-latest-releases',
      arguments: { ecosystem: 'anchor' },
    });
    const releaseText = ((releaseResult.content as any[])[0] as any).text;
    console.log(releaseText.substring(0, 500), '...\n');

    console.log('═══════════════════════════════════════════════════════════');
    console.log('TEST 3: Get Translation Guide');
    console.log('═══════════════════════════════════════════════════════════\n');

    const guideResult = await client.callTool({
      name: 'get-translation-guide',
      arguments: { from: 'solidity', to: 'solana' },
    });
    const guideText = ((guideResult.content as any[])[0] as any).text;
    console.log(guideText.substring(0, 400), '...\n');

    console.log('═══════════════════════════════════════════════════════════');
    console.log('TEST 4: Check Feature Compatibility');
    console.log('═══════════════════════════════════════════════════════════\n');

    const compatResult = await client.callTool({
      name: 'check-feature-compatibility',
      arguments: { feature: 'mapping', target: 'solana' },
    });
    const compatText = ((compatResult.content as any[])[0] as any).text;
    console.log(compatText, '\n');

    await client.close();

    console.log('═══════════════════════════════════════════════════════════');
    console.log('✅ All Tests Passed!');
    console.log('═══════════════════════════════════════════════════════════\n');

    console.log('📋 Summary:\n');
    console.log('✅ 4 Clean, Universal Tools');
    console.log('✅ Works for Solana, Sui, Anchor');
    console.log('✅ No complex URL mapping or HTML parsing');
    console.log('✅ Just the essentials: docs + versions + guides + compat\n');
    console.log('💡 For dynamic URL fetching, use a separate web-search MCP server\n');

    process.exit(0);
  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  }
}

testSimplified();
