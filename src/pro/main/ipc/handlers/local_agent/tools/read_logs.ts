import { z } from "zod";
import { ToolDefinition, AgentContext, escapeXmlContent } from "./types";
import { db } from "@/db";
import { chats } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getLogs } from "@/lib/log_store";
import type { ConsoleEntry } from "@/ipc/types";

const readLogsSchema = z.object({
  type: z
    .enum(["all", "client", "server", "edge-function", "network-requests"])
    .optional()
    .describe(
      "Filter by log source type (default: all). Types: 'client' = browser console logs; 'server' = backend (including development server) logs and build output; 'edge-function' = edge function logs; 'network-requests' = HTTP requests and responses (outgoing calls and their responses).",
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
});

function truncateMessage(message: string, maxLength: number = 1000): string {
  if (message.length <= maxLength) {
    return message;
  }

  // Check if it's a stack trace (lines starting with "    at " indicate stack frames)
  const lines = message.split("\n");
  const hasStackTrace = lines.some((line) => line.startsWith("    at "));

  if (hasStackTrace) {
    const errorMessage = lines[0];
    const stackFrames = lines
      .filter((line) => line.startsWith("    at "))
      .slice(0, 5);

    return (
      errorMessage +
      "\n" +
      stackFrames.join("\n") +
      "\n... [stack trace truncated]"
    );
  }

  // Regular truncation - preserve start and end
  const halfLength = Math.floor((maxLength - 20) / 2);
  return (
    message.slice(0, halfLength) +
    "\n... [truncated] ...\n" +
    message.slice(-halfLength)
  );
}

function formatLogsForAI(logs: ConsoleEntry[]): string {
  const summary = `Found ${logs.length} log${logs.length === 1 ? "" : "s"}:\n\n`;

  const formatted = logs
    .map((log) => {
      const timestamp = new Date(log.timestamp).toISOString();
      const level = log.level.toUpperCase();
      const type = log.type;
      const source = log.sourceName ? ` [${log.sourceName}]` : "";
      const message = truncateMessage(log.message);

      return `[${timestamp}] [${level}] [${type}]${source} ${message}`;
    })
    .join("\n");

  return summary + formatted;
}

export const readLogsTool: ToolDefinition<z.infer<typeof readLogsSchema>> = {
  name: "read_logs",
  description:
    "Read logs at the moment this tool is called. Includes client logs, server logs, edge function logs, and network requests. Use this to debug errors, investigate issues, or understand app behavior. IMPORTANT: Logs are a snapshot from when you call this tool - they will NOT update while you are writing code or making changes. Use filters (searchTerm, type, level) to narrow down relevant logs on the first call.",
  inputSchema: readLogsSchema,
  defaultConsent: "always",

  buildXml: (args, isComplete) => {
    // When complete, return undefined so execute's onXmlComplete provides the final XML
    // This prevents showing two separate components
    if (isComplete) {
      return undefined;
    }

    const filters = [];
    if (args.type && args.type !== "all") filters.push(`type="${args.type}"`);
    if (args.level && args.level !== "all")
      filters.push(`level="${args.level}"`);

    // Build a descriptive summary of what's being queried
    const parts: string[] = ["Time: last 5 minutes"];

    if (args.type && args.type !== "all") parts.push(`Type: ${args.type}`);
    if (args.level && args.level !== "all") parts.push(`Level: ${args.level}`);
    if (args.searchTerm)
      parts.push(`Search: "${escapeXmlContent(args.searchTerm)}"`);
    if (args.limit) parts.push(`Limit: ${args.limit}`);

    const summary = parts.join(" | ");

    return `<dyad-read-logs ${filters.join(" ")}>
${summary}
</dyad-read-logs>`;
  },

  execute: async (args, ctx: AgentContext) => {
    // Get the chat to find the appId
    const chat = await db.query.chats.findFirst({
      where: eq(chats.id, ctx.chatId),
      with: { app: true },
    });

    if (!chat || !chat.app) {
      throw new Error("Chat or app not found.");
    }

    const appId = chat.app.id;

    // Get logs directly from central log store (no UI coupling!)
    const allLogs = getLogs(appId);

    // Apply time filter (hardcoded: last 5 minutes)
    const cutoff = Date.now() - 5 * 60 * 1000;
    let filtered = allLogs.filter((log) => log.timestamp >= cutoff);

    // Apply type filter
    if (args.type && args.type !== "all") {
      filtered = filtered.filter((log) => log.type === args.type);
    }

    // Apply level filter
    if (args.level && args.level !== "all") {
      filtered = filtered.filter((log) => log.level === args.level);
    }

    // Apply search term filter
    if (args.searchTerm) {
      const term = args.searchTerm.toLowerCase();
      filtered = filtered.filter((log) =>
        log.message.toLowerCase().includes(term),
      );
    }

    // Sort by timestamp (oldest to newest)
    filtered.sort((a, b) => a.timestamp - b.timestamp);

    // Limit results (take most recent)
    const limit = Math.min(args.limit ?? 50, 200);
    filtered = filtered.slice(-limit);

    // Format logs for display
    const formattedLogs =
      filtered.length === 0
        ? "No logs found matching the specified filters."
        : formatLogsForAI(filtered);

    // Build the query summary for display
    const parts: string[] = ["Time: last 5 minutes"];
    if (args.type && args.type !== "all") parts.push(`Type: ${args.type}`);
    if (args.level && args.level !== "all") parts.push(`Level: ${args.level}`);
    if (args.searchTerm)
      parts.push(`Search: "${escapeXmlContent(args.searchTerm)}"`);
    if (args.limit) parts.push(`Limit: ${args.limit}`);
    const summary = parts.join(" | ");

    // Build filter attributes for the tag
    const filters = [];
    if (args.type && args.type !== "all") filters.push(`type="${args.type}"`);
    if (args.level && args.level !== "all")
      filters.push(`level="${args.level}"`);

    // Output the complete results in a single tag
    ctx.onXmlComplete(
      `<dyad-read-logs ${filters.join(" ")} count="${filtered.length}">\n${summary}\n\n${escapeXmlContent(formattedLogs)}\n</dyad-read-logs>`,
    );

    return formattedLogs;
  },
};
