import { z } from "zod";
import { ToolDefinition, AgentContext, escapeXmlContent } from "./types";
import { db } from "@/db";
import { chats } from "@/db/schema";
import { eq } from "drizzle-orm";
import type { ConsoleEntry } from "@/ipc/types";
import { getLogs } from "@/lib/log_store";
import { formatLogsForAI } from "@/shared/format_logs";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import {
  describeSupabaseLogError,
  getAppEdgeFunctionLogs,
  resolveAppSupabaseLogTarget,
  type AppSupabaseLogTarget,
} from "@/supabase_admin/supabase_edge_logs_service";
import type { TimeRange } from "@/supabase_admin/supabase_log_cache";
import {
  describeQueriedWindow,
  describeRequestedWindow,
  resolveReadLogsWindow,
  type ReadLogsWindow,
} from "./read_logs_window";

const readLogsSchema = z.object({
  type: z
    .enum(["all", "client", "server", "edge-function", "network-requests"])
    .optional()
    .describe(
      "Filter by log source type (default: all). Types: 'client' = browser console logs; 'server' = backend (including development server) logs and build output; 'edge-function' = Supabase Edge Function logs, fetched from the app's connected Supabase project; 'network-requests' = HTTP requests and responses (outgoing calls and their responses).",
    ),

  level: z
    .enum(["all", "info", "warn", "error"])
    .optional()
    .describe("Filter by log level (default: all)"),

  searchTerm: z
    .string()
    .optional()
    .describe("Search for logs containing this text (case-insensitive)"),

  limit: z
    .number()
    .min(1)
    .max(200)
    .optional()
    .describe("Maximum number of logs to return (default: 50, max: 200)"),

  startTime: z
    .string()
    .optional()
    .describe(
      "Start of the time window, as an ISO 8601 timestamp with an explicit timezone (e.g. '2026-01-15T14:30:00Z' or '2026-01-15T09:30:00-05:00'). Omit to start 5 minutes before endTime (or 5 minutes ago when endTime is also omitted).",
    ),

  endTime: z
    .string()
    .optional()
    .describe(
      "End of the time window, as an ISO 8601 timestamp with an explicit timezone. Omit to end at the current time. Must not be in the future, and the window can span at most 24 hours.",
    ),
});

type ReadLogsArgs = z.infer<typeof readLogsSchema>;

/** Supabase is only queried when the filter can include its logs. */
function includesSupabaseLogs(type: ReadLogsArgs["type"]): boolean {
  return type === undefined || type === "all" || type === "edge-function";
}

function buildFilterSummary(args: ReadLogsArgs, timePart: string): string {
  const parts: string[] = [timePart];
  if (args.type && args.type !== "all") parts.push(`Type: ${args.type}`);
  if (args.level && args.level !== "all") parts.push(`Level: ${args.level}`);
  if (args.searchTerm) parts.push(`Search: "${args.searchTerm}"`);
  if (args.limit) parts.push(`Limit: ${args.limit}`);
  return parts.join(" | ");
}

function buildFilterAttributes(args: ReadLogsArgs): string {
  const filters = [];
  if (args.type && args.type !== "all") filters.push(`type="${args.type}"`);
  if (args.level && args.level !== "all") filters.push(`level="${args.level}"`);
  return filters.join(" ");
}

function describeRanges(ranges: TimeRange[], window: ReadLogsWindow): string {
  const shown = ranges.slice(0, 3).map((range) => {
    const start = Math.max(range.start, window.start);
    const end = Math.min(range.end, window.end);
    return `${new Date(start).toISOString()} to ${new Date(end).toISOString()}`;
  });
  const more = ranges.length > 3 ? ` and ${ranges.length - 3} more` : "";
  return `${shown.join(", ")}${more}`;
}

/**
 * Edge Function logs for the window. Provider problems become a warning so
 * local logs are still returned; only cancellation propagates.
 */
async function readSupabaseLogs(
  target: AppSupabaseLogTarget,
  window: ReadLogsWindow,
  signal: AbortSignal | undefined,
): Promise<{ logs: ConsoleEntry[]; warning: string | null }> {
  try {
    const result = await getAppEdgeFunctionLogs({
      target,
      start: window.start,
      // The window is inclusive of its end; the cache takes [start, end).
      end: window.end + 1,
      signal,
    });
    // The association check after the cache read can outlast a cancellation.
    signal?.throwIfAborted();
    if (result.associationChanged) {
      return {
        logs: [],
        warning:
          "Partial results: Supabase Edge Function logs were omitted because this app's Supabase connection changed while they were being fetched. Call read_logs again to read the current connection's logs.",
      };
    }
    if (result.missingRanges.length === 0) {
      return { logs: result.entries, warning: null };
    }
    const ranges = describeRanges(result.missingRanges, window);
    return {
      logs: result.entries,
      warning: result.error
        ? `Partial results: Supabase Edge Function logs could not be fetched for ${ranges} (${describeSupabaseLogError(result.error)}). This is not the same as there being no Edge Function logs. Local logs and any Edge Function logs already retrieved for this window are shown.`
        : `Partial results: this window has more Supabase Edge Function logs than read_logs retrieves in one call, so logs from ${ranges} were not retrieved. Call read_logs again with a narrower startTime/endTime window to read them.`,
    };
  } catch (error) {
    if (signal?.aborted) throw error;
    return {
      logs: [],
      warning: `Partial results: Supabase Edge Function logs could not be fetched (${describeSupabaseLogError(error)}). This is not the same as there being no Edge Function logs. Showing local logs only.`,
    };
  }
}

export const readLogsTool: ToolDefinition<ReadLogsArgs> = {
  name: "read_logs",
  description:
    "Read the app's logs for a time window (default: the last 5 minutes). Includes client logs, server logs, network requests, and Supabase Edge Function logs. Edge Function logs are fetched on demand from the app's connected Supabase project whenever type is 'all' or 'edge-function'. Use this to debug errors, investigate issues, or understand app behavior. To investigate an older incident, pass startTime and/or endTime (ISO 8601 with a timezone) to read an earlier or wider window, up to 24 hours per call. Client, server, and network logs come from Dyad's local history, which only retains the most recent logs, so older windows may include only Edge Function logs. IMPORTANT: Logs are a snapshot from when you call this tool - they will NOT update while you are writing code or making changes. Use filters (searchTerm, type, level) to narrow down relevant logs on the first call.",
  inputSchema: readLogsSchema,
  defaultConsent: "always",

  buildXml: (args, isComplete) => {
    // When complete, return undefined so execute's onXmlComplete provides the final XML
    // This prevents showing two separate components
    if (isComplete) {
      return undefined;
    }

    const summary = buildFilterSummary(args, describeRequestedWindow(args));

    return `<dyad-read-logs ${buildFilterAttributes(args)}>
${escapeXmlContent(summary)}
</dyad-read-logs>`;
  },

  execute: async (args, ctx: AgentContext) => {
    // Capture "now" once so local and Supabase logs share one exact window.
    const now = Date.now();
    const window = resolveReadLogsWindow(args, now);

    // Get the chat to find the app and its current Supabase association
    const chat = await db.query.chats.findFirst({
      where: eq(chats.id, ctx.chatId),
      with: { app: true },
    });

    if (!chat || !chat.app) {
      throw new DyadError("Chat or app not found.", DyadErrorKind.NotFound);
    }

    const appId = chat.app.id;
    const inWindow = (log: ConsoleEntry) =>
      log.timestamp >= window.start && log.timestamp <= window.end;

    // Local logs from the central log store (no UI coupling)
    const localLogs = getLogs(appId).filter(inWindow);

    // Supabase Edge Function logs, fetched on demand for the linked project.
    // Apps without a Supabase project keep local logs only.
    let remoteLogs: ConsoleEntry[] = [];
    let warning: string | null = null;
    const wantsSupabaseLogs =
      includesSupabaseLogs(args.type) && !!chat.app.supabaseProjectId;
    const target = wantsSupabaseLogs
      ? resolveAppSupabaseLogTarget(chat.app)
      : null;
    if (target) {
      ({ logs: remoteLogs, warning } = await readSupabaseLogs(
        target,
        window,
        ctx.abortSignal,
      ));
    } else if (wantsSupabaseLogs) {
      // A linked project whose organization Dyad holds no credentials for.
      // Without this an edge-function read would look like a clean result.
      warning =
        "Partial results: Supabase Edge Function logs were not read because Dyad is not connected to the Supabase organization that owns this app's project. Ask the user to reconnect Supabase in Settings to include them.";
    }

    const remoteIds = new Set(remoteLogs.map((log) => log.providerLogId));
    let filtered = [
      ...localLogs.filter(
        (log) => !log.providerLogId || !remoteIds.has(log.providerLogId),
      ),
      ...remoteLogs.filter(inWindow),
    ];

    // Apply type filter
    if (args.type && args.type !== "all") {
      filtered = filtered.filter(
        (log) => log.runtimeBoundary !== undefined || log.type === args.type,
      );
    }

    // Apply level filter
    if (args.level && args.level !== "all") {
      filtered = filtered.filter(
        (log) => log.runtimeBoundary !== undefined || log.level === args.level,
      );
    }

    // Apply search term filter
    if (args.searchTerm) {
      const term = args.searchTerm.toLowerCase();
      filtered = filtered.filter(
        (log) =>
          log.runtimeBoundary !== undefined ||
          log.message.toLowerCase().includes(term),
      );
    }

    // Sort by timestamp (oldest to newest)
    filtered.sort((a, b) => a.timestamp - b.timestamp);

    // Limit matching logs while retaining lifecycle boundaries as session
    // metadata. A small limit must not replace the only matching error with a
    // trailing restart marker.
    const limit = Math.min(args.limit ?? 50, 200);
    const recentLogs = filtered
      .filter((log) => !log.runtimeBoundary)
      .slice(-limit);
    const recentLogSet = new Set(recentLogs);
    filtered = filtered.filter(
      (log) => log.runtimeBoundary !== undefined || recentLogSet.has(log),
    );

    // Format logs for display. A provider failure must never read as "no
    // logs found", so the warning comes first and the empty message says
    // what was actually searched.
    const logsText =
      recentLogs.length === 0
        ? warning
          ? "No logs matched the specified filters among the logs that could be read (see the warning above)."
          : "No logs found matching the specified filters."
        : formatLogsForAI(filtered, recentLogs.length);
    const formattedLogs = warning ? `⚠️ ${warning}\n\n${logsText}` : logsText;

    const summary = buildFilterSummary(args, describeQueriedWindow(window));

    // Output the complete results in a single tag
    ctx.onXmlComplete(
      `<dyad-read-logs ${buildFilterAttributes(args)} count="${recentLogs.length}">\n${escapeXmlContent(summary)}\n\n${escapeXmlContent(formattedLogs)}\n</dyad-read-logs>`,
    );

    return `${summary}\n\n${formattedLogs}`;
  },
};
