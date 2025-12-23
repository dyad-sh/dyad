import { z } from "zod";
import { ToolDefinition, AgentContext } from "./types";
import { db } from "@/db";
import { chats } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getLogs } from "@/main/log_store";

const readLogsSchema = z.object({
  timeWindow: z
    .enum(["last-minute", "last-5-minutes", "last-hour", "all"])
    .optional()
    .describe("Time range to fetch logs from (default: last-5-minutes)"),

  type: z
    .enum([
      "all",
      "client",
      "server",
      "edge-function",
      "network-requests",
      "build-time",
    ])
    .optional()
    .describe("Filter by log source type (default: all)"),

  level: z
    .enum(["all", "info", "warn", "error"])
    .optional()
    .describe("Filter by log level (default: all)"),

  sourceName: z
    .string()
    .optional()
    .describe("Filter by source name (e.g., specific edge function name)"),

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

interface ConsoleEntry {
  level: "info" | "warn" | "error";
  type:
    | "server"
    | "client"
    | "edge-function"
    | "network-requests"
    | "build-time";
  message: string;
  timestamp: number;
  sourceName?: string;
  appId: number;
}

function getTimeCutoff(timeWindow: string): number {
  const now = Date.now();
  switch (timeWindow) {
    case "last-minute":
      return now - 60 * 1000;
    case "last-5-minutes":
      return now - 5 * 60 * 1000;
    case "last-hour":
      return now - 60 * 60 * 1000;
    default:
      return 0; // "all"
  }
}

function truncateMessage(message: string, maxLength: number = 500): string {
  if (message.length <= maxLength) {
    return message;
  }

  // Check if it's a stack trace
  if (message.includes("at ") && message.includes("\n")) {
    const lines = message.split("\n");
    const errorMessage = lines[0];
    const stackFrames = lines.slice(1, 6); // First 5 stack frames

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
    "Read console logs from the app preview at the moment this tool is called. Includes client logs, server logs, edge function logs, and network requests. Use this to debug errors, investigate issues, or understand app behavior. IMPORTANT: Logs are a snapshot from when you call this tool - they will NOT update while you are writing code or making changes. Use filters (searchTerm, type, level) to narrow down relevant logs on the first call.",
  inputSchema: readLogsSchema,
  defaultConsent: "always",

  buildXml: (args, isComplete) => {
    if (!isComplete) return undefined;

    const filters = [];
    if (args.timeWindow) filters.push(`time="${args.timeWindow}"`);
    if (args.type && args.type !== "all") filters.push(`type="${args.type}"`);
    if (args.level && args.level !== "all")
      filters.push(`level="${args.level}"`);

    // Build a descriptive summary of what's being queried
    const parts: string[] = [];
    const timeWindow = args.timeWindow || "last-5-minutes";
    parts.push(`Time: ${timeWindow}`);

    if (args.type && args.type !== "all") parts.push(`Type: ${args.type}`);
    if (args.level && args.level !== "all") parts.push(`Level: ${args.level}`);
    if (args.sourceName) parts.push(`Source: ${args.sourceName}`);
    if (args.searchTerm) parts.push(`Search: "${args.searchTerm}"`);
    if (args.limit) parts.push(`Limit: ${args.limit}`);

    const summary = parts.join(" | ");

    return `<dyad-read-logs ${filters.join(" ")}>\n${summary}\n</dyad-read-logs>`;
  },

  execute: async (args, ctx: AgentContext) => {
    try {
      // Get the chat to find the appId
      const chat = await db.query.chats.findFirst({
        where: eq(chats.id, ctx.chatId),
        with: { app: true },
      });

      if (!chat || !chat.app) {
        return "Failed to read logs: Chat or app not found.";
      }

      const appId = chat.app.id;

      // Get logs directly from central log store (no UI coupling!)
      const allLogs = getLogs(appId);

      // Apply time filter (default: last 5 minutes)
      const timeWindow = args.timeWindow ?? "last-5-minutes";
      const cutoff = getTimeCutoff(timeWindow);
      let filtered = allLogs.filter((log) => log.timestamp >= cutoff);

      // Apply type filter
      if (args.type && args.type !== "all") {
        filtered = filtered.filter((log) => log.type === args.type);
      }

      // Apply level filter
      if (args.level && args.level !== "all") {
        filtered = filtered.filter((log) => log.level === args.level);
      }

      // Apply source name filter
      if (args.sourceName) {
        filtered = filtered.filter((log) => log.sourceName === args.sourceName);
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

      // Return formatted logs
      if (filtered.length === 0) {
        return "No logs found matching the specified filters.";
      }

      return formatLogsForAI(filtered);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      return `Failed to read logs: ${errorMessage}`;
    }
  },
};
