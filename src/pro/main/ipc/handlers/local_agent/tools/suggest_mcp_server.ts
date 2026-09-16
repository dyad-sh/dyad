import { z } from "zod";
import log from "electron-log";
import { isNotNull } from "drizzle-orm";
import { db } from "@/db";
import { mcpServers } from "@/db/schema";
import {
  getRemoteMcpCatalog,
  peekRemoteMcpCatalog,
} from "@/ipc/shared/remote_mcp_catalog";
import type { McpCatalogEntry } from "@/ipc/types/mcp_catalog";
import { userInputRegistry } from "@/user_input/main";
import {
  ToolDefinition,
  AgentContext,
  ToolDescriptionContext,
  escapeXmlAttr,
} from "./types";

const logger = log.scope("suggest_mcp_server");

/** A catalog plugin the agent may offer to the user mid-task. */
export interface SuggestableMcpServer {
  slug: string;
  name: string;
  description?: string;
  /** Whether the plugin only works after the user authorizes it. */
  oauthRequired: boolean;
}

/**
 * How long a turn waits on a cold catalog cache. A warm cache returns at
 * once; a cold one keeps fetching in the background after this and is
 * ready for the next turn, so an unreachable catalog host costs at most
 * this much per turn rather than the client's full fetch timeout.
 */
const COLD_CATALOG_WAIT_MS = 1_000;

// Suggestions the user declined, per chat, so the plugin is not offered
// again in that conversation. In-memory: a restart clears it, which is
// acceptable for a preference this small.
const declinedSlugsByChat = new Map<number, Set<string>>();
// Chats with a suggestion currently parked. The agent can issue parallel
// tool calls, and the chat card can show only one live suggestion.
const chatsWithLiveSuggestion = new Set<number>();

export function resetSuggestMcpServerStateForTests() {
  declinedSlugsByChat.clear();
  chatsWithLiveSuggestion.clear();
}

async function readCatalog(cachedOnly: boolean): Promise<McpCatalogEntry[]> {
  const cached = peekRemoteMcpCatalog();
  if (cached) return cached;
  if (cachedOnly) return [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  const waited = await Promise.race([
    getRemoteMcpCatalog(),
    new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), COLD_CATALOG_WAIT_MS);
    }),
  ]);
  clearTimeout(timer);
  return waited ?? [];
}

/**
 * Featured catalog plugins the user has not added or declined in this
 * chat. Only one-click entries qualify: http transport with nothing to
 * configure, so the chat card can add and connect them without a detour
 * through the setup page. stdio entries need the run-locally consent
 * dialog and entries with `inputs` need the setup page; both stay in the
 * Plugins catalog for now.
 *
 * With `cachedOnly`, an unfetched catalog yields an empty list instead of
 * waiting on the network.
 */
export async function collectSuggestableMcpServers({
  chatId,
  cachedOnly = false,
}: {
  chatId: number;
  cachedOnly?: boolean;
}): Promise<SuggestableMcpServer[]> {
  const entries = await readCatalog(cachedOnly);
  if (entries.length === 0) return [];
  const rows = await db
    .select({ catalogSlug: mcpServers.catalogSlug })
    .from(mcpServers)
    .where(isNotNull(mcpServers.catalogSlug));
  const added = new Set(rows.map((row) => row.catalogSlug));
  const declined = declinedSlugsByChat.get(chatId);
  return entries
    .filter(
      (entry) =>
        entry.featured === true &&
        entry.transport === "http" &&
        (entry.inputs?.length ?? 0) === 0 &&
        !added.has(entry.slug) &&
        !declined?.has(entry.slug),
    )
    .map((entry) => ({
      slug: entry.slug,
      name: entry.name,
      description: entry.description,
      oauthRequired: entry.transport === "http" && !!entry.oauth?.required,
    }));
}

const suggestMcpServerSchema = z.object({
  slug: z
    .string()
    .min(1)
    .describe(
      "Slug of the plugin to suggest. Must be one of the slugs listed in this tool's description.",
    ),
  reason: z
    .string()
    .min(1)
    .max(300)
    .describe(
      "One sentence, addressed to the user, stating the step you are about to take that needs this plugin. Shown on the suggestion card and used to resume the task once the plugin is connected.",
    ),
});

type SuggestMcpServerArgs = z.infer<typeof suggestMcpServerSchema>;

const BASE_DESCRIPTION = `Ask the user to connect a Dyad plugin (an MCP server from the curated catalog) so you can use its tools.

Call this only at the moment your next step needs a capability that one of the plugins below provides and no available tool can do it, for example reading a platform's deployment or runtime logs, inspecting live data on that platform, or creating a resource there. Never call it speculatively because the project happens to use that vendor, and never suggest the same plugin twice in a conversation.

The tool blocks until the user connects the plugin or declines. When the user connects it, the plugin's tools are NOT available in this turn: Dyad queues a follow-up turn where they will be. In that case end your response with one short line saying you will continue once the plugin is ready, and do not attempt the step another way. If the user declines, continue without the plugin.`;

function formatAvailablePlugins(servers: SuggestableMcpServer[]): string {
  const lines = servers.map((server) => {
    const description = server.description?.trim();
    return description
      ? `- ${server.slug}: ${server.name} — ${description}`
      : `- ${server.slug}: ${server.name}`;
  });
  return `Plugins available to suggest (slug: name — what it does):\n${lines.join("\n")}`;
}

function pendingXml(args: Partial<SuggestMcpServerArgs>): string | undefined {
  if (!args.slug) return undefined;
  const reason = args.reason ? ` reason="${escapeXmlAttr(args.reason)}"` : "";
  return `<dyad-suggest-mcp-server slug="${escapeXmlAttr(args.slug)}"${reason} outcome="pending"></dyad-suggest-mcp-server>`;
}

function terminalXml(
  server: { slug: string; name: string },
  reason: string,
  outcome: "connected" | "declined" | "dismissed",
): string {
  return `<dyad-suggest-mcp-server slug="${escapeXmlAttr(server.slug)}" name="${escapeXmlAttr(server.name)}" reason="${escapeXmlAttr(reason)}" outcome="${outcome}"></dyad-suggest-mcp-server>`;
}

export const suggestMcpServerTool: ToolDefinition<SuggestMcpServerArgs> = {
  name: "suggest_mcp_server",
  description: BASE_DESCRIPTION,
  getDescription: (ctx: ToolDescriptionContext) => {
    const servers = ctx.suggestableMcpServers ?? [];
    if (servers.length === 0) return BASE_DESCRIPTION;
    return `${BASE_DESCRIPTION}\n\n${formatAvailablePlugins(servers)}`;
  },
  inputSchema: suggestMcpServerSchema,
  defaultConsent: "always",
  // Adding a plugin changes main-process state, so the tool stays out of
  // Ask and Plan; it never touches the workspace, so finalization has
  // nothing to track and blueprint approval does not gate it.
  modifiesState: true,
  mutationTracking: "none",
  requiresBlueprintApproval: false,
  isEnabled: (ctx) => (ctx.suggestableMcpServers?.length ?? 0) > 0,

  getConsentPreview: (args) => `Suggest connecting the ${args.slug} plugin`,

  // Persist the interactive card before execute() parks so reloads and
  // cross-window tab transfers can reconstruct the pending request. A
  // terminal outcome is appended after settlement; the renderer hides this
  // pending card once its request is no longer live.
  buildXml: (args, _isComplete) => pendingXml(args),

  execute: async (args, ctx: AgentContext) => {
    const servers = ctx.suggestableMcpServers ?? [];
    const server = servers.find((candidate) => candidate.slug === args.slug);
    // Nothing is requested on these paths, so the persisted pending card
    // would never settle; close it out explicitly.
    if (!server) {
      ctx.onXmlComplete(
        terminalXml(
          { slug: args.slug, name: args.slug },
          args.reason,
          "dismissed",
        ),
      );
      const available = servers.map((candidate) => candidate.slug).join(", ");
      return available
        ? `"${args.slug}" is not a plugin you can suggest. Available slugs: ${available}. Either pick one of those or continue without a plugin.`
        : `"${args.slug}" is not a plugin you can suggest, and no plugins are available to suggest right now. Continue without one.`;
    }
    if (chatsWithLiveSuggestion.has(ctx.chatId)) {
      ctx.onXmlComplete(terminalXml(server, args.reason, "dismissed"));
      return `Another plugin suggestion is already waiting for the user in this chat. Wait for its result before suggesting ${server.name}.`;
    }

    const followUpPrompt = `Continue. I have connected the ${server.name} plugin. Resume what you needed it for: ${args.reason}`;
    chatsWithLiveSuggestion.add(ctx.chatId);
    try {
      const requestId = userInputRegistry.request({
        kind: "mcp-suggestion",
        chatId: ctx.chatId,
        messageId: ctx.messageId,
        slug: server.slug,
        serverName: server.name,
        serverDescription: server.description ?? null,
        oauthRequired: server.oauthRequired,
        reason: args.reason,
        classifier: "none",
        followUpPrompt,
      });
      logger.log(
        `Presenting plugin suggestion (slug: ${server.slug}), requestId: ${requestId}`,
      );

      const result = await userInputRegistry.park(requestId, ctx.abortSignal);

      if (result?.kind !== "mcp-suggestion") {
        ctx.onXmlComplete(terminalXml(server, args.reason, "dismissed"));
        return `The user did not respond to the ${server.name} plugin suggestion. Continue without it, and ask them how they'd like to proceed if the step cannot be completed another way.`;
      }
      if (result.outcome === "declined") {
        let declined = declinedSlugsByChat.get(ctx.chatId);
        if (!declined) {
          declined = new Set();
          declinedSlugsByChat.set(ctx.chatId, declined);
        }
        declined.add(server.slug);
        ctx.onXmlComplete(terminalXml(server, args.reason, "declined"));
        return `The user declined to connect the ${server.name} plugin. Continue the task without it and do not suggest it again in this conversation.`;
      }
      ctx.onXmlComplete(terminalXml(server, args.reason, "connected"));
      return `The user connected the ${server.name} plugin. Its tools are not available in this turn; Dyad has queued a follow-up turn where they will be. End your response now with one short line saying you will continue once the plugin is ready, and do not attempt the step another way.`;
    } finally {
      chatsWithLiveSuggestion.delete(ctx.chatId);
    }
  },
};
