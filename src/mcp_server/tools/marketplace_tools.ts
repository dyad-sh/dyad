/**
 * MCP Tools — Joy Marketplace
 *
 * Browse and inspect assets on the Joy Marketplace (api.joymarketplace.io).
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

const API_BASE = "https://api.joymarketplace.io";

async function marketplaceFetch(path: string) {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) {
    throw new Error(`Marketplace API error ${res.status}: ${res.statusText}`);
  }
  return res.json();
}

export function registerMarketplaceTools(server: McpServer) {
  // ── Browse marketplace ───────────────────────────────────────────
  server.registerTool(
    "joycreate_marketplace_browse",
    {
      description:
        "Search or browse the Joy Marketplace for agents, workflows, prompts, and other assets.",
      inputSchema: {
        query: z.string().optional().describe("Search query"),
        category: z
          .enum(["agent", "workflow", "prompt", "dataset", "template"])
          .optional()
          .describe("Filter by asset category"),
        page: z.number().optional().describe("Page number (default 1)"),
        limit: z.number().optional().describe("Results per page (default 20)"),
      },
    },
    async ({ query, category, page, limit }) => {
      const params = new URLSearchParams();
      if (query) params.set("q", query);
      if (category) params.set("category", category);
      params.set("page", String(page ?? 1));
      params.set("limit", String(limit ?? 20));

      try {
        const data = await marketplaceFetch(`/v1/assets?${params}`);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
        };
      } catch (err: any) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error browsing marketplace: ${err.message}`,
            },
          ],
        };
      }
    },
  );

  // ── Asset detail ─────────────────────────────────────────────────
  server.registerTool(
    "joycreate_marketplace_asset_detail",
    {
      description:
        "Get detailed information about a specific Joy Marketplace asset by its ID.",
      inputSchema: {
        assetId: z.string().describe("The marketplace asset ID"),
      },
    },
    async ({ assetId }) => {
      try {
        const data = await marketplaceFetch(`/v1/assets/${encodeURIComponent(assetId)}`);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
        };
      } catch (err: any) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error fetching asset ${assetId}: ${err.message}`,
            },
          ],
        };
      }
    },
  );
}
