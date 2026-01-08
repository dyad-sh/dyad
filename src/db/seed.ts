/**
 * Database seeding functions
 * Run after migrations to ensure default data exists
 */

import { db } from "./index";
import { mcpServers } from "./schema";
import { eq } from "drizzle-orm";
import log from "electron-log";
import path from "node:path";
import { app } from "electron";

const logger = log.scope("db:seed");

/**
 * Seeds the default blockchain-guide MCP server
 */
export async function seedBlockchainGuideMcpServer() {
  try {
    // Check if blockchain-guide server already exists
    const existing = await db
      .select()
      .from(mcpServers)
      .where(eq(mcpServers.name, "blockchain-guide"));

    if (existing.length > 0) {
      logger.info("Blockchain-guide MCP server already exists, skipping seed");
      return;
    }

    // Get the path to the MCP server
    // In development: <app>/mcp-servers/blockchain-guide/dist/index.js
    // In production: <resources>/mcp-servers/blockchain-guide/dist/index.js
    const isDev = !app.isPackaged;
    const serverPath = isDev
      ? path.join(
          __dirname,
          "..",
          "..",
          "mcp-servers",
          "blockchain-guide",
          "dist",
          "index.js",
        )
      : path.join(
          process.resourcesPath,
          "mcp-servers",
          "blockchain-guide",
          "dist",
          "index.js",
        );

    logger.info("Seeding blockchain-guide MCP server at:", serverPath);

    // Insert the default server
    await db.insert(mcpServers).values({
      name: "blockchain-guide",
      transport: "stdio",
      command: "node",
      args: [serverPath],
      envJson: null,
      url: null,
      enabled: true, // Enable by default
    });

    logger.info("✅ Successfully seeded blockchain-guide MCP server");
  } catch (error) {
    logger.error("Failed to seed blockchain-guide MCP server:", error);
  }
}

/**
 * Run all seed functions
 */
export async function runSeeds() {
  logger.info("Running database seeds...");
  await seedBlockchainGuideMcpServer();
  logger.info("Database seeding complete");
}
