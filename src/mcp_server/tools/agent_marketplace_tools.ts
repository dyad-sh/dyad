/**
 * MCP Tools — Agent Marketplace Autonomy & On-Chain Bridge
 *
 * Allows AI agents to browse, buy, list, and sell assets on Joy Marketplace
 * and import ERC-1155 tokens into the local Asset Studio.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ipcMain } from "electron";

// Helper to invoke existing IPC handlers from MCP context
async function invokeHandler(channel: string, ...args: unknown[]): Promise<any> {
  // Get the handler registered on ipcMain
  const handler = (ipcMain as any)._invokeHandlers?.get(channel);
  if (handler) {
    return handler({ sender: { id: -1 } }, ...args);
  }
  // Fallback: use electron's internal invoke
  throw new Error(`IPC handler not found: ${channel}. Ensure handlers are registered before MCP server starts.`);
}

export function registerAgentMarketplaceTools(server: McpServer) {
  // ── Browse marketplace as an agent ───────────────────────────────
  server.registerTool(
    "agent_marketplace_browse",
    {
      description:
        "Browse the Joy Marketplace for assets an agent can use (models, datasets, algorithms, prompts). " +
        "Returns active listings with prices and verification scores.",
      inputSchema: {
        agentId: z.string().describe("The agent ID making the request"),
        query: z.string().optional().describe("Search query"),
        assetType: z.string().optional().describe("Filter by type: model, dataset, agent, algorithm, prompt, workflow, template"),
        maxPrice: z.number().optional().describe("Maximum price in MATIC"),
        first: z.number().optional().describe("Max results (default 50)"),
      },
    },
    async (params) => {
      try {
        const result = await invokeHandler("agent-market:browse", params);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (err: any) {
        return {
          content: [{ type: "text" as const, text: `Error browsing marketplace: ${err.message}` }],
        };
      }
    },
  );

  // ── Browse AI models specifically ────────────────────────────────
  server.registerTool(
    "agent_marketplace_browse_models",
    {
      description:
        "Browse AI models available on Joy Marketplace. Shows verified status, quality scores, and usage counts.",
      inputSchema: {
        verified: z.boolean().optional().describe("Only show verified models"),
        first: z.number().optional().describe("Max results (default 50)"),
      },
    },
    async (params) => {
      try {
        const result = await invokeHandler("agent-market:browse-models", params);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (err: any) {
        return {
          content: [{ type: "text" as const, text: `Error browsing models: ${err.message}` }],
        };
      }
    },
  );

  // ── Request purchase ─────────────────────────────────────────────
  server.registerTool(
    "agent_marketplace_buy",
    {
      description:
        "Request purchase of an asset from Joy Marketplace. Creates a purchase intent that requires " +
        "user approval before the on-chain transaction is executed. Agents cannot buy without approval.",
      inputSchema: {
        agentId: z.string().describe("The agent ID making the purchase"),
        listingId: z.string().describe("Marketplace listing ID"),
        tokenId: z.string().describe("Token ID to purchase"),
        reason: z.string().describe("Why the agent needs this asset"),
        maxBudget: z.number().describe("Maximum budget in MATIC the agent is willing to spend"),
      },
    },
    async (params) => {
      try {
        const result = await invokeHandler("agent-market:request-purchase", params);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (err: any) {
        return {
          content: [{ type: "text" as const, text: `Error requesting purchase: ${err.message}` }],
        };
      }
    },
  );

  // ── Request listing ──────────────────────────────────────────────
  server.registerTool(
    "agent_marketplace_sell",
    {
      description:
        "Request to list a local asset on Joy Marketplace for sale. Creates a listing intent that " +
        "requires user approval before the on-chain transaction is executed.",
      inputSchema: {
        agentId: z.string().describe("The agent ID creating the listing"),
        localAssetId: z.string().describe("Local asset ID in Asset Studio"),
        assetType: z.string().describe("Asset type (model, dataset, agent, etc.)"),
        price: z.number().describe("Price in MATIC"),
        currency: z.string().optional().describe("Currency (default: MATIC)"),
        reason: z.string().describe("Why this asset should be listed"),
      },
    },
    async (params) => {
      try {
        const result = await invokeHandler("agent-market:request-listing", params);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (err: any) {
        return {
          content: [{ type: "text" as const, text: `Error requesting listing: ${err.message}` }],
        };
      }
    },
  );

  // ── Check licenses ───────────────────────────────────────────────
  server.registerTool(
    "agent_marketplace_my_licenses",
    {
      description:
        "Check what AI model licenses the user currently holds on Joy Marketplace.",
      inputSchema: {
        walletAddress: z.string().describe("User's wallet address"),
      },
    },
    async ({ walletAddress }) => {
      try {
        const result = await invokeHandler("agent-market:my-licenses", walletAddress);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (err: any) {
        return {
          content: [{ type: "text" as const, text: `Error checking licenses: ${err.message}` }],
        };
      }
    },
  );

  // ── Import on-chain tokens ───────────────────────────────────────
  server.registerTool(
    "onchain_import_my_tokens",
    {
      description:
        "Import the user's ERC-1155 JoyLicenseToken holdings from Joy Marketplace into the local " +
        "Asset Studio. Resolves on-chain metadata and creates local asset entries.",
      inputSchema: {
        walletAddress: z.string().describe("User's wallet address to import tokens from"),
      },
    },
    async ({ walletAddress }) => {
      try {
        const result = await invokeHandler("onchain-bridge:import-all", walletAddress);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (err: any) {
        return {
          content: [{ type: "text" as const, text: `Error importing tokens: ${err.message}` }],
        };
      }
    },
  );

  // ── View pending intents ─────────────────────────────────────────
  server.registerTool(
    "agent_marketplace_pending",
    {
      description:
        "View all pending purchase and listing intents from agents waiting for user approval.",
      inputSchema: {},
    },
    async () => {
      try {
        const result = await invokeHandler("agent-market:pending-intents");
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (err: any) {
        return {
          content: [{ type: "text" as const, text: `Error getting intents: ${err.message}` }],
        };
      }
    },
  );
}
