#!/usr/bin/env node
/**
 * Quick test for Sui documentation fetching
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function testSuiDocs() {
  console.log("🧪 Testing Sui Documentation Fetching\n");

  const transport = new StdioClientTransport({
    command: "node",
    args: [path.join(__dirname, "dist", "index.js")],
  });

  const client = new Client(
    { name: "test-client", version: "1.0.0" },
    { capabilities: {} },
  );

  try {
    await client.connect(transport);
    console.log("✅ Connected to MCP server\n");

    console.log("📥 Fetching Sui documentation (this may take a moment)...\n");
    const result = await client.callTool({
      name: "fetch-ecosystem-docs",
      arguments: { ecosystem: "sui" },
    });

    const content = result.content as any[];
    const text = content[0].text;
    const sizeKB = (text.length / 1024).toFixed(0);

    console.log("═══════════════════════════════════════════════════════════");
    console.log(`✅ Fetched ${sizeKB}KB of Sui documentation`);
    console.log(
      "═══════════════════════════════════════════════════════════\n",
    );

    console.log("Preview (first 1000 chars):");
    console.log(text.substring(0, 1000));
    console.log("\n...\n");

    if (parseInt(sizeKB) > 5) {
      console.log(
        "✅ SUCCESS: Sui documentation is being fetched dynamically!",
      );
      console.log(
        `   Size: ${sizeKB}KB (expected: >10KB from aggregated pages)`,
      );
    } else {
      console.log(
        "⚠️  WARNING: Documentation size is small, sitemap crawling may not be working",
      );
    }

    await client.close();
    process.exit(0);
  } catch (error) {
    console.error("❌ Test failed:", error);
    await client.close();
    process.exit(1);
  }
}

testSuiDocs();
