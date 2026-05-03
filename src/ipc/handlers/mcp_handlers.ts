import { BrowserWindow, IpcMainInvokeEvent } from "electron";
import os from "node:os";
import log from "electron-log";
import { db } from "../../db";
import { mcpServers, mcpToolConsents } from "../../db/schema";
import { eq, and, inArray } from "drizzle-orm";
import { createLoggedHandler } from "./safe_handle";

import { resolveConsent } from "../utils/mcp_consent";
import { getStoredConsent, requireMcpToolConsent } from "../utils/mcp_consent";
import { mcpManager } from "../utils/mcp_manager";
import {
  mcpHubManager,
  type McpServerStatusInfo,
} from "../utils/mcp_hub_manager";
import { buildMcpToolSet } from "../../lib/mcp_ai_bridge";
import { CreateMcpServer, McpServerUpdate, McpTool } from "../ipc_types";

const logger = log.scope("mcp_handlers");
const handle = createLoggedHandler(logger);

type ConsentDecision = "accept-once" | "accept-always" | "decline";

let statusForwarderRegistered = false;

function registerStatusForwarder() {
  if (statusForwarderRegistered) return;
  statusForwarderRegistered = true;
  mcpHubManager.on("status-change", (info: McpServerStatusInfo) => {
    for (const win of BrowserWindow.getAllWindows()) {
      try {
        if (!win.isDestroyed()) {
          win.webContents.send("mcp:status-change", info);
        }
      } catch (err) {
        logger.warn("Failed to forward mcp status-change to window", err);
      }
    }
  });
}

export function registerMcpHandlers() {
  registerStatusForwarder();
  // Essential MCP server seeding (n8n + reference servers) must happen AFTER
  // initializeDatabase() runs in main.ts. Caller invokes seedEssentialMcpServers()
  // from main during startup; this handler module no longer self-seeds because
  // registerIpcHandlers() runs before initializeDatabase().

  // CRUD for MCP servers
  handle("mcp:list-servers", async () => {
    return await db.select().from(mcpServers);
  });

  handle(
    "mcp:create-server",
    async (_event: IpcMainInvokeEvent, params: CreateMcpServer) => {
      const { name, transport, command, args, envJson, url, enabled } = params;
      const result = await db
        .insert(mcpServers)
        .values({
          name,
          transport,
          command: command || null,
          args: args || null,
          envJson: envJson || null,
          url: url || null,
          enabled: !!enabled,
        })
        .returning();
      return result[0];
    },
  );

  handle(
    "mcp:update-server",
    async (_event: IpcMainInvokeEvent, params: McpServerUpdate) => {
      const update: any = {};
      if (params.name !== undefined) update.name = params.name;
      if (params.transport !== undefined) update.transport = params.transport;
      if (params.command !== undefined) update.command = params.command;
      if (params.args !== undefined) update.args = params.args || null;
      if (params.cwd !== undefined) update.cwd = params.cwd;
      if (params.envJson !== undefined) update.envJson = params.envJson || null;
      if (params.url !== undefined) update.url = params.url;
      if (params.enabled !== undefined) update.enabled = !!params.enabled;

      const result = await db
        .update(mcpServers)
        .set(update)
        .where(eq(mcpServers.id, params.id))
        .returning();
      // If server config changed, dispose cached client to be recreated on next use
      try {
        mcpManager.dispose(params.id);
      } catch {}
      return result[0];
    },
  );

  handle(
    "mcp:delete-server",
    async (_event: IpcMainInvokeEvent, id: number) => {
      try {
        mcpManager.dispose(id);
      } catch {}
      await db.delete(mcpServers).where(eq(mcpServers.id, id));
      return { success: true };
    },
  );

  // Tools listing (dynamic) — uses the new hub manager.
  handle(
    "mcp:list-tools",
    async (
      _event: IpcMainInvokeEvent,
      serverId: number,
    ): Promise<McpTool[]> => {
      // Tolerant by design: if the server is offline / mid-restart / not yet
      // started (e.g. n8n still booting), return an empty list rather than
      // throwing. The renderer polls list-tools on a timer; throwing here
      // surfaces a toast on every poll which spams the UI.
      let remoteTools;
      try {
        remoteTools = await mcpHubManager.listTools(serverId);
      } catch (err) {
        logger.warn(
          `[mcp:list-tools] server ${serverId} unreachable, returning empty list:`,
          err instanceof Error ? err.message : err,
        );
        return [];
      }
      const tools = await Promise.all(
        remoteTools.map(async (tool) => ({
          name: tool.name,
          description: tool.description ?? null,
          consent: await getStoredConsent(serverId, tool.name),
        })),
      );
      return tools;
    },
  );
  // Consents
  handle("mcp:get-tool-consents", async () => {
    return await db.select().from(mcpToolConsents);
  });

  handle(
    "mcp:set-tool-consent",
    async (
      _event: IpcMainInvokeEvent,
      params: {
        serverId: number;
        toolName: string;
        consent: "ask" | "always" | "denied";
      },
    ) => {
      const existing = await db
        .select()
        .from(mcpToolConsents)
        .where(
          and(
            eq(mcpToolConsents.serverId, params.serverId),
            eq(mcpToolConsents.toolName, params.toolName),
          ),
        );
      if (existing.length > 0) {
        const result = await db
          .update(mcpToolConsents)
          .set({ consent: params.consent })
          .where(
            and(
              eq(mcpToolConsents.serverId, params.serverId),
              eq(mcpToolConsents.toolName, params.toolName),
            ),
          )
          .returning();
        return result[0];
      } else {
        const result = await db
          .insert(mcpToolConsents)
          .values({
            serverId: params.serverId,
            toolName: params.toolName,
            consent: params.consent,
          })
          .returning();
        return result[0];
      }
    },
  );

  // Tool consent request/response handshake
  // Receive consent response from renderer
  handle(
    "mcp:tool-consent-response",
    async (_event, data: { requestId: string; decision: ConsentDecision }) => {
      resolveConsent(data.requestId, data.decision);
    },
  );

  // ─── Status / connection management ───────────────────────────────
  handle("mcp:get-status", async (_event, serverId: number) => {
    return mcpHubManager.getStatus(serverId);
  });

  handle("mcp:get-all-statuses", async () => {
    return mcpHubManager.getAllStatuses();
  });

  handle("mcp:connect", async (_event, serverId: number) => {
    await mcpHubManager.connect(serverId);
  });

  handle("mcp:disconnect", async (_event, serverId: number) => {
    await mcpHubManager.disconnect(serverId);
  });

  handle("mcp:reconnect", async (_event, serverId: number) => {
    await mcpHubManager.reconnect(serverId);
  });

  handle("mcp:ping", async (_event, serverId: number) => {
    await mcpHubManager.ping(serverId);
    return { ok: true };
  });

  // ─── Tool execution with consent gating ───────────────────────────
  handle(
    "mcp:call-tool",
    async (
      event: IpcMainInvokeEvent,
      params: { serverId: number; name: string; args?: unknown },
    ) => {
      const { serverId, name, args } = params ?? {};
      if (!Number.isFinite(serverId) || !Number.isInteger(serverId) || (serverId as number) <= 0) {
        throw new Error("mcp:call-tool: 'serverId' must be a positive integer");
      }
      if (typeof name !== "string" || name.trim().length === 0) {
        throw new Error("mcp:call-tool: 'name' must be a non-empty string");
      }
      const stored = await getStoredConsent(serverId, name);
      if (stored === "denied") {
        throw new Error(`Tool '${name}' is denied by user consent`);
      }
      if (stored !== "always") {
        // Look up the server name for a nicer prompt; fall back to id.
        const rows = await db
          .select()
          .from(mcpServers)
          .where(eq(mcpServers.id, serverId));
        const serverName = rows[0]?.name ?? `MCP #${serverId}`;
        const inputPreview =
          typeof args === "string"
            ? args
            : JSON.stringify(args ?? {}).slice(0, 500);
        const ok = await requireMcpToolConsent(event, {
          serverId,
          serverName,
          toolName: name,
          inputPreview,
        });
        if (!ok) {
          throw new Error(`Tool '${name}' was denied by the user`);
        }
      }
      return await mcpHubManager.callTool(serverId, name, args);
    },
  );

  // ─── Resources ────────────────────────────────────────────────────
  handle("mcp:list-resources", async (_event, serverId: number) => {
    return await mcpHubManager.listResources(serverId);
  });

  handle("mcp:list-resource-templates", async (_event, serverId: number) => {
    return await mcpHubManager.listResourceTemplates(serverId);
  });

  handle(
    "mcp:read-resource",
    async (_event, params: { serverId: number; uri: string }) => {
      return await mcpHubManager.readResource(params.serverId, params.uri);
    },
  );

  // ─── Prompts ──────────────────────────────────────────────────────
  handle("mcp:list-prompts", async (_event, serverId: number) => {
    return await mcpHubManager.listPrompts(serverId);
  });

  handle(
    "mcp:get-prompt",
    async (
      _event,
      params: {
        serverId: number;
        name: string;
        args?: Record<string, string>;
      },
    ) => {
      return await mcpHubManager.getPrompt(
        params.serverId,
        params.name,
        params.args,
      );
    },
  );

  // ─── Live tool catalog (used by orchestrator / n8n / studios) ────
  // Returns a flat catalog of every tool that every enabled MCP server
  // currently exposes. Renderers / studios use this to populate pickers,
  // prompt builders, n8n nodes, etc.
  handle("mcp:get-tool-catalog", async () => {
    const result = await buildMcpToolSet();
    const catalog: Array<{
      serverId: number;
      serverName: string;
      toolName: string;
      qualifiedName: string;
      description: string;
    }> = [];
    const slug = (s: string) =>
      s.toLowerCase().replace(/[^a-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 48);
    for (const s of result.summary.serversIncluded) {
      try {
        const remote = await mcpHubManager.listTools(s.id);
        for (const t of remote) {
          catalog.push({
            serverId: s.id,
            serverName: s.name,
            toolName: t.name,
            qualifiedName: `mcp__${slug(s.name)}__${slug(t.name)}`,
            description: t.description ?? "",
          });
        }
      } catch (err) {
        logger.warn(`Failed to list tools for catalog: ${s.name}`, err);
      }
    }
    return {
      catalog,
      serversIncluded: result.summary.serversIncluded,
      serversFailed: result.summary.serversFailed,
      totalTools: result.summary.totalTools,
    };
  });

  // ─── Seed essentials ──────────────────────────────────────────────
  // Idempotently insert a curated set of MCP servers (n8n + official
  // reference servers) so users have working defaults out of the box.
  // Lookup is by `name` so re-running is safe. Servers are inserted
  // disabled by default; the user toggles them on from the Hub.
  handle("mcp:ensure-essentials", async () => {
    return await seedEssentialServers();
  });
}

const ESSENTIAL_MCP_SERVERS: CreateMcpServer[] = [
  // ── Local automation hub ────────────────────────────────────────
  {
    name: "n8n (local)",
    transport: "http",
    url: "http://localhost:5678/mcp/joycreate/sse",
    envJson: null,
    enabled: false,
  },
  // ── Official reference servers (free, no API key) ───────────────
  // NOTE: stdio transport spawns `command` directly with `args` — never
  // bake a full shell line into `command`, or the spawn will look for an
  // executable literally named e.g. "npx -y @upstash/context7-mcp@latest".
  {
    name: "Context7",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@upstash/context7-mcp@latest"],
    enabled: false,
  },
  {
    name: "Memory",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-memory"],
    enabled: false,
  },
  {
    name: "Fetch",
    transport: "stdio",
    command: "npx",
    // @modelcontextprotocol/server-fetch does not exist on npm.
    // Use @mcp/server-fetch (community fork) or omit entirely.
    // Disabled until an installable package name is confirmed.
    args: ["-y", "@modelcontextprotocol/server-everything"],
    enabled: false,
  },
  {
    name: "Time",
    transport: "stdio",
    command: "npx",
    // @modelcontextprotocol/server-time does not exist on npm.
    args: ["-y", "mcp-server-time"],
    enabled: false,
  },
  {
    name: "Sequential Thinking",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-sequential-thinking"],
    enabled: false,
  },
  {
    name: "Filesystem",
    transport: "stdio",
    command: "npx",
    // Stdio child processes don't get shell expansion, so passing "~"
    // literally would point the server at a directory called "~". Resolve
    // it to the user's home up front.
    args: ["-y", "@modelcontextprotocol/server-filesystem", os.homedir()],
    enabled: false,
  },
  {
    name: "Git",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-git"],
    enabled: false,
  },
  // ── Code & dev platforms ────────────────────────────────────────
  {
    name: "GitHub",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-github"],
    envJson: { GITHUB_PERSONAL_ACCESS_TOKEN: "" },
    enabled: false,
  },
  {
    name: "GitLab",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-gitlab"],
    envJson: { GITLAB_PERSONAL_ACCESS_TOKEN: "", GITLAB_API_URL: "https://gitlab.com/api/v4" },
    enabled: false,
  },
  // ── Databases ───────────────────────────────────────────────────
  {
    name: "PostgreSQL",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-postgres", "postgresql://localhost/postgres"],
    enabled: false,
  },
  {
    name: "SQLite",
    transport: "stdio",
    command: "npx",
    // @modelcontextprotocol/server-sqlite does not exist on npm.
    args: ["-y", "mcp-server-sqlite-npx"],
    enabled: false,
  },
  // ── Web search ──────────────────────────────────────────────────
  {
    name: "Brave Search",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-brave-search"],
    envJson: { BRAVE_API_KEY: "" },
    enabled: false,
  },
  // ── Communication ───────────────────────────────────────────────
  {
    name: "Slack",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-slack"],
    envJson: { SLACK_BOT_TOKEN: "", SLACK_TEAM_ID: "" },
    enabled: false,
  },
  // ── Productivity ────────────────────────────────────────────────
  {
    name: "Notion",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@notionhq/notion-mcp-server"],
    envJson: { NOTION_API_KEY: "" },
    enabled: false,
  },
  {
    name: "Linear",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-linear"],
    envJson: { LINEAR_API_KEY: "" },
    enabled: false,
  },
  // ── Browser automation ──────────────────────────────────────────
  {
    name: "Puppeteer",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-puppeteer"],
    enabled: false,
  },
  // ── Cloud / payments / observability ────────────────────────────
  {
    name: "Stripe",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@stripe/mcp", "--tools=all"],
    envJson: { STRIPE_SECRET_KEY: "" },
    enabled: false,
  },
  {
    name: "Sentry",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@sentry/mcp-server"],
    envJson: { SENTRY_AUTH_TOKEN: "" },
    enabled: false,
  },
];

/**
 * Seed essential MCP servers (n8n + reference servers) into the DB.
 * Exported as `seedEssentialMcpServers` so main.ts can invoke it AFTER
 * `initializeDatabase()` completes. Idempotent by name; safe to re-run.
 */
export async function seedEssentialMcpServers(): Promise<{
  inserted: string[];
  skipped: number;
}> {
  return seedEssentialServers();
}

async function seedEssentialServers(): Promise<{
  inserted: string[];
  skipped: number;
}> {
  // One-time cleanup: disable any previously-seeded entries whose npx packages
  // do not exist on the npm registry (they cause 404 errors and toast noise).
  const BROKEN_PACKAGES = [
    "@modelcontextprotocol/server-fetch",
    "@modelcontextprotocol/server-time",
    "@modelcontextprotocol/server-sqlite",
  ];
  try {
    const stale = await db
      .select({ id: mcpServers.id, args: mcpServers.args })
      .from(mcpServers);
    const staleIds = stale
      .filter((s) => {
        const args = s.args as string[] | null;
        return args?.some((a) => BROKEN_PACKAGES.includes(a)) ?? false;
      })
      .map((s) => s.id);
    if (staleIds.length > 0) {
      await db
        .update(mcpServers)
        .set({ enabled: false })
        .where(inArray(mcpServers.id, staleIds));
      logger.info(`Disabled ${staleIds.length} stale MCP server(s) with broken package names`);
    }
  } catch (err) {
    logger.warn("Failed to clean up stale MCP servers", err);
  }

  const existing = await db.select().from(mcpServers);
  const existingNames = new Set(existing.map((s) => s.name));
  const inserted: string[] = [];
  for (const e of ESSENTIAL_MCP_SERVERS) {
    if (existingNames.has(e.name)) continue;
    try {
      await db.insert(mcpServers).values({
        name: e.name,
        transport: e.transport,
        command: e.command || null,
        args: e.args || null,
        envJson: e.envJson || null,
        url: e.url || null,
        enabled: !!e.enabled,
      });
      inserted.push(e.name);
    } catch (err) {
      logger.warn(`Failed to seed essential MCP server '${e.name}'`, err);
    }
  }
  return { inserted, skipped: ESSENTIAL_MCP_SERVERS.length - inserted.length };
}
