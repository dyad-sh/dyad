import { z } from "zod";
import log from "electron-log";
import { eq, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import { mcpServers } from "@/db/schema";
import {
  getRemoteMcpCatalog,
  peekRemoteMcpCatalog,
} from "@/ipc/shared/remote_mcp_catalog";
import type {
  HttpCatalogEntry,
  McpCatalogEntry,
} from "@/ipc/types/mcp_catalog";
import { oauthStateHasTokens } from "@/ipc/utils/mcp_oauth_provider";
import { readSettings, tryWriteSettings } from "@/main/settings";
import { userInputRegistry } from "@/user_input/main";
import {
  ToolDefinition,
  AgentContext,
  ToolDescriptionContext,
  escapeXmlAttr,
} from "./types";

const logger = log.scope("suggest_plugin");

/** A catalog plugin the agent may offer to the user mid-task. */
export interface SuggestablePlugin {
  slug: string;
  name: string;
  description?: string;
  /** Whether the plugin only works after the user authorizes it. */
  oauthRequired: boolean;
  /** Whether connecting it still has to run that authorization. */
  needsOAuth: boolean;
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
// Slugs already offered in a turn, keyed by chat and assistant message, so
// a suggestion that timed out or was dismissed is not parked a second time
// in the same turn.
const attemptedSlugsByTurn = new Map<string, Set<string>>();

export function resetSuggestPluginStateForTests() {
  declinedSlugsByChat.clear();
  chatsWithLiveSuggestion.clear();
  attemptedSlugsByTurn.clear();
}

function addTo(
  map: Map<number | string, Set<string>>,
  key: number | string,
  slug: string,
) {
  let set = map.get(key);
  if (!set) {
    set = new Set();
    map.set(key, set);
  }
  set.add(slug);
}

interface PluginRow {
  catalogSlug: string | null;
  enabled: boolean;
  oauthState: string | null;
}

// Built on use rather than at import, so loading this module never
// depends on the schema being fully available.
function pluginRowColumns() {
  return {
    catalogSlug: mcpServers.catalogSlug,
    enabled: mcpServers.enabled,
    oauthState: mcpServers.oauthState,
  };
}

// The OAuth column holds the client registration before any token exists,
// so only a stored access token counts as authorized.
function isAuthorized(row: PluginRow | undefined) {
  return oauthStateHasTokens(row?.oauthState ?? null);
}

// A plugin can serve tools once it is added, enabled, and authorized when
// its catalog entry requires that. Anything short of this is worth
// suggesting: the card can enable or authorize an existing row.
function isUsable(row: PluginRow | undefined, oauthRequired: boolean) {
  if (!row || !row.enabled) return false;
  return !oauthRequired || isAuthorized(row);
}

async function isPluginUsable(
  slug: string,
  oauthRequired: boolean,
): Promise<boolean> {
  const rows = await db
    .select(pluginRowColumns())
    .from(mcpServers)
    .where(eq(mcpServers.catalogSlug, slug));
  return isUsable(rows[0], oauthRequired);
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
 * Featured catalog plugins that cannot serve tools yet (never added,
 * disabled, or not authorized), minus the ones the user declined in this
 * chat or asked never to be offered again. Only one-click entries qualify:
 * http transport with nothing to configure, so the chat card can add and
 * connect them without a detour through the setup page. stdio entries need
 * the run-locally consent dialog and entries with `inputs` need the setup
 * page; both stay in the Plugins catalog for now.
 *
 * With `cachedOnly`, an unfetched catalog yields an empty list instead of
 * waiting on the network.
 */
export async function collectSuggestablePlugins({
  chatId,
  cachedOnly = false,
}: {
  chatId: number;
  cachedOnly?: boolean;
}): Promise<SuggestablePlugin[]> {
  const entries = await readCatalog(cachedOnly);
  if (entries.length === 0) return [];
  const rows: PluginRow[] = await db
    .select(pluginRowColumns())
    .from(mcpServers)
    .where(isNotNull(mcpServers.catalogSlug));
  const rowBySlug = new Map(rows.map((row) => [row.catalogSlug, row]));
  const declined = declinedSlugsByChat.get(chatId);
  const neverSuggest = new Set(readSettings().neverSuggestPluginSlugs ?? []);
  return entries
    .filter(
      (entry): entry is HttpCatalogEntry =>
        entry.featured === true &&
        entry.transport === "http" &&
        (entry.inputs?.length ?? 0) === 0 &&
        !declined?.has(entry.slug) &&
        !neverSuggest.has(entry.slug),
    )
    .map((entry) => {
      const oauthRequired = !!entry.oauth?.required;
      const row = rowBySlug.get(entry.slug);
      return { entry, oauthRequired, row };
    })
    .filter(({ row, oauthRequired }) => !isUsable(row, oauthRequired))
    .map(({ entry, oauthRequired, row }) => ({
      slug: entry.slug,
      name: entry.name,
      description: entry.description,
      oauthRequired,
      needsOAuth: oauthRequired && !isAuthorized(row),
    }));
}

const suggestPluginSchema = z.object({
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

type SuggestPluginArgs = z.infer<typeof suggestPluginSchema>;

const BASE_DESCRIPTION = `Ask the user to connect a Dyad plugin (an MCP server from the curated catalog) so you can use its tools.

Call this only at the moment your next step needs a capability that one of the plugins below provides and no available tool can do it, for example reading a platform's deployment or runtime logs, inspecting live data on that platform, or creating a resource there. Never call it speculatively because the project happens to use that vendor, and never suggest the same plugin twice in a conversation.

The tool blocks until the user connects the plugin or declines. When the user connects it, the plugin's tools are NOT available in this turn: Dyad queues a follow-up turn where they will be. In that case end your response with one short line saying you will continue once the plugin is ready, and do not attempt the step another way. If the user declines, continue without the plugin.`;

function formatAvailablePlugins(servers: SuggestablePlugin[]): string {
  const lines = servers.map((server) => {
    const description = server.description?.trim();
    return description
      ? `- ${server.slug}: ${server.name} — ${description}`
      : `- ${server.slug}: ${server.name}`;
  });
  return `Plugins available to suggest (slug: name — what it does):\n${lines.join("\n")}`;
}

function pendingXml(
  server: { slug: string; name: string },
  reason: string,
  requestId: string,
): string {
  return `<dyad-suggest-plugin slug="${escapeXmlAttr(server.slug)}" name="${escapeXmlAttr(server.name)}" reason="${escapeXmlAttr(reason)}" request-id="${escapeXmlAttr(requestId)}" outcome="pending"></dyad-suggest-plugin>`;
}

function terminalXml(
  server: { slug: string; name: string },
  reason: string,
  outcome: "connected" | "declined" | "never" | "dismissed",
): string {
  return `<dyad-suggest-plugin slug="${escapeXmlAttr(server.slug)}" name="${escapeXmlAttr(server.name)}" reason="${escapeXmlAttr(reason)}" outcome="${outcome}"></dyad-suggest-plugin>`;
}

export const suggestPluginTool: ToolDefinition<SuggestPluginArgs> = {
  name: "suggest_plugin",
  description: BASE_DESCRIPTION,
  getDescription: (ctx: ToolDescriptionContext) => {
    const servers = ctx.suggestablePlugins ?? [];
    if (servers.length === 0) return BASE_DESCRIPTION;
    return `${BASE_DESCRIPTION}\n\n${formatAvailablePlugins(servers)}`;
  },
  inputSchema: suggestPluginSchema,
  defaultConsent: "always",
  // Adding a plugin changes main-process state, so the tool stays out of
  // Ask and Plan; it never touches the workspace, so finalization has
  // nothing to track and blueprint approval does not gate it.
  modifiesState: true,
  mutationTracking: "none",
  requiresBlueprintApproval: false,
  isEnabled: (ctx) => (ctx.suggestablePlugins?.length ?? 0) > 0,

  getConsentPreview: (args) => `Suggest connecting the ${args.slug} plugin`,

  execute: async (args, ctx: AgentContext) => {
    const servers = ctx.suggestablePlugins ?? [];
    const server = servers.find((candidate) => candidate.slug === args.slug);
    // Nothing is requested on these paths, so a dismissed card records the
    // attempt in the transcript without rendering anything.
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
    // Claim the chat before any await so a parallel call cannot slip past
    // the check above.
    chatsWithLiveSuggestion.add(ctx.chatId);
    try {
      // The turn's suggestable set is fixed at turn start, so re-check what
      // has settled since: a decline in this chat, an earlier attempt this
      // turn, or a plugin that became usable.
      if (declinedSlugsByChat.get(ctx.chatId)?.has(server.slug)) {
        ctx.onXmlComplete(terminalXml(server, args.reason, "dismissed"));
        return `The user already declined the ${server.name} plugin in this conversation. Continue without it and do not suggest it again.`;
      }
      const turnKey = `${ctx.chatId}:${ctx.messageId}`;
      if (attemptedSlugsByTurn.get(turnKey)?.has(server.slug)) {
        ctx.onXmlComplete(terminalXml(server, args.reason, "dismissed"));
        return `You already suggested the ${server.name} plugin in this turn and the user did not connect it. Continue without it.`;
      }
      if (await isPluginUsable(server.slug, server.oauthRequired)) {
        ctx.onXmlComplete(terminalXml(server, args.reason, "dismissed"));
        return `The ${server.name} plugin is already connected. Its tools become available the next time the user sends a message, not in this turn. Tell the user that and continue with whatever you can do without it.`;
      }

      const followUpPrompt = `Continue. I have connected the ${server.name} plugin. Resume what you needed it for: ${args.reason}`;
      const requestId = userInputRegistry.request({
        kind: "plugin-suggestion",
        chatId: ctx.chatId,
        slug: server.slug,
        serverName: server.name,
        serverDescription: server.description ?? null,
        needsOAuth: server.needsOAuth,
        reason: args.reason,
        classifier: "none",
        followUpPrompt,
      });
      addTo(attemptedSlugsByTurn, turnKey, server.slug);
      // Persist the interactive card, carrying the request id, before the
      // park: reloads and cross-window tab transfers rebuild it from the
      // message, and the id is what makes only this card live.
      ctx.onXmlComplete(pendingXml(server, args.reason, requestId));
      logger.log(
        `Presenting plugin suggestion (slug: ${server.slug}), requestId: ${requestId}`,
      );

      const result = await userInputRegistry.park(requestId, ctx.abortSignal);

      if (result?.kind !== "plugin-suggestion") {
        ctx.onXmlComplete(terminalXml(server, args.reason, "dismissed"));
        return `The user did not respond to the ${server.name} plugin suggestion. Continue without it, and ask them how they'd like to proceed if the step cannot be completed another way.`;
      }
      if (result.outcome === "declined") {
        addTo(declinedSlugsByChat, ctx.chatId, server.slug);
        ctx.onXmlComplete(terminalXml(server, args.reason, "declined"));
        return `The user declined to connect the ${server.name} plugin. Continue the task without it and do not suggest it again in this conversation.`;
      }
      if (result.outcome === "never") {
        // Persisted per plugin, so it holds across chats and restarts.
        // Best-effort: the user has answered, so a settings problem must
        // not abort the tool before the card and the model hear about it.
        // The per-chat decline below still covers this conversation.
        const existing = readSettings().neverSuggestPluginSlugs ?? [];
        if (!existing.includes(server.slug)) {
          tryWriteSettings(
            { neverSuggestPluginSlugs: [...existing, server.slug] },
            "storing a plugin's never-suggest choice",
          );
        }
        addTo(declinedSlugsByChat, ctx.chatId, server.slug);
        ctx.onXmlComplete(terminalXml(server, args.reason, "never"));
        return `The user asked never to be offered the ${server.name} plugin again. Continue the task without it and never suggest it again.`;
      }
      ctx.onXmlComplete(terminalXml(server, args.reason, "connected"));
      return `The user connected the ${server.name} plugin. Its tools are not available in this turn; Dyad has queued a follow-up turn where they will be. End your response now with one short line saying you will continue once the plugin is ready, and do not attempt the step another way.`;
    } finally {
      chatsWithLiveSuggestion.delete(ctx.chatId);
    }
  },
};
