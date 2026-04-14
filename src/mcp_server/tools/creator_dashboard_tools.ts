/**
 * MCP Tools — Creator Dashboard
 * Earnings, analytics, portfolio, and creator status via JoyCreate's Creator Dashboard.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export function registerCreatorDashboardTools(server: McpServer) {
  server.registerTool(
    "joycreate_creator_stats",
    {
      description: "Get creator stats — total earnings, asset count, downloads, top-performing assets, and trend data from Joy Marketplace.",
      inputSchema: {
        period: z.enum(["7d", "30d", "90d", "all"]).optional().describe("Time period (default 30d)"),
      },
    },
    async (params) => {
      try {
        const { getCreatorStats } = require("@/ipc/handlers/creator_dashboard_handlers");
        const result = await getCreatorStats?.(params) ?? { error: "Creator dashboard not available" };
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (e: any) {
        return { content: [{ type: "text" as const, text: `Error: ${e.message}` }] };
      }
    }
  );

  server.registerTool(
    "joycreate_creator_portfolio",
    {
      description: "List all published assets in your creator portfolio on Joy Marketplace — with pricing, sales, and status.",
      inputSchema: {
        status: z.enum(["all", "published", "draft", "unlisted"]).optional().describe("Filter by listing status"),
        type: z.string().optional().describe("Filter by asset type"),
        limit: z.number().optional(),
      },
    },
    async (params) => {
      try {
        const { getPortfolio } = require("@/ipc/handlers/creator_dashboard_handlers");
        const result = await getPortfolio?.(params) ?? { assets: [] };
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (e: any) {
        return { content: [{ type: "text" as const, text: `Error: ${e.message}` }] };
      }
    }
  );

  server.registerTool(
    "joycreate_creator_earnings",
    {
      description: "Get detailed earnings breakdown — sales revenue, royalties, pending payouts, and transaction history.",
      inputSchema: {
        period: z.enum(["7d", "30d", "90d", "all"]).optional(),
        include_royalties: z.boolean().optional().describe("Include royalty earnings (default true)"),
      },
    },
    async (params) => {
      try {
        const { getEarnings } = require("@/ipc/handlers/creator_dashboard_handlers");
        const result = await getEarnings?.(params) ?? { error: "Earnings data not available" };
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (e: any) {
        return { content: [{ type: "text" as const, text: `Error: ${e.message}` }] };
      }
    }
  );

  server.registerTool(
    "joycreate_analytics",
    {
      description: "Get analytics for your JoyCreate projects — usage, performance benchmarks, model costs, and quality scores.",
      inputSchema: {
        type: z.enum(["usage", "performance", "cost", "quality", "all"]).optional().describe("Analytics type"),
        period: z.enum(["7d", "30d", "90d"]).optional(),
      },
    },
    async (params) => {
      try {
        const { getAnalytics } = require("@/ipc/handlers/analytics_reporting_handlers");
        const result = await getAnalytics?.(params) ?? { error: "Analytics not available" };
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (e: any) {
        return { content: [{ type: "text" as const, text: `Error: ${e.message}` }] };
      }
    }
  );
}
