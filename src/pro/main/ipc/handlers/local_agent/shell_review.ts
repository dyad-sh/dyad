import { promises as fs } from "node:fs";
import path from "node:path";
import { tool } from "ai";
import { z } from "zod";
import { reviewToolAction } from "./tool_safety_reviewer";
import { getRecentTurnsForConsent } from "./mcp_consent_context";
import { buildShellReviewPrompt } from "@/prompts/shell_review_policy";
import { shellExecutionGuidance } from "@/shared/shell_capability";
import type { AgentContext } from "./tools/types";
import { readSettings } from "@/main/settings";

export function buildShellInspectionTool(appPath: string, signal: AbortSignal) {
  let reads = 0;
  return tool({
    description:
      "Read a small ordinary app file or inspect path metadata. No command execution. Secret targets and paths outside the app are unavailable.",
    inputSchema: z.object({
      path: z.string().max(1024),
      read: z.boolean().default(false),
    }),
    execute: async ({ path: relative, read }) => {
      signal.throwIfAborted();
      if (++reads > 6) throw new Error("Inspection budget exhausted");
      if (
        path.isAbsolute(relative) ||
        path.win32.isAbsolute(relative) ||
        relative
          .split(/[\\/]/)
          .some(
            (part) =>
              part === ".." ||
              part === ".git" ||
              part === ".dyad" ||
              /^\.env(?:\.|$)|secret|credential|^\.ssh$|^\.aws$/i.test(part),
          )
      ) {
        throw new Error("Inspection path is unavailable");
      }
      const root = await fs.realpath(appPath);
      const target = await fs.realpath(path.resolve(root, relative));
      const resolvedRelative = path.relative(root, target);
      if (
        resolvedRelative.startsWith("..") ||
        path.isAbsolute(resolvedRelative) ||
        resolvedRelative
          .split(path.sep)
          .some((part) =>
            /^\.env(?:\.|$)|secret|credential|^\.git$|^\.dyad$/i.test(part),
          )
      )
        throw new Error("Inspection path is unavailable");
      const stat = await fs.stat(target);
      if (!read)
        return {
          type: stat.isFile()
            ? "file"
            : stat.isDirectory()
              ? "directory"
              : "other",
          bytes: stat.size,
          resolvedRelative,
        };
      if (!stat.isFile() || stat.size > 24_000)
        throw new Error(
          "Inspection requires an ordinary file of at most 24 KB",
        );
      signal.throwIfAborted();
      // Bounded read even if the file grows between stat and open.
      const file = await fs.open(target, "r");
      try {
        const buffer = Buffer.alloc(24_001);
        const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
        signal.throwIfAborted();
        if (bytesRead > 24_000)
          throw new Error("Inspection file exceeds budget");
        return {
          resolvedRelative,
          untrustedContent: buffer.subarray(0, bytesRead).toString("utf8"),
        };
      } finally {
        await file.close();
      }
    },
  });
}

export function reviewShellCommand(
  command: string,
  description: string,
  ctx: AgentContext,
) {
  return reviewToolAction({
    settings: ctx.inferenceSettings ?? readSettings(),
    system: buildShellReviewPrompt(),
    fallback: "block",
    signal: ctx.abortSignal,
    prepare: async (signal) => {
      const recentTurns = await getRecentTurnsForConsent(ctx.chatId);
      if (
        !recentTurns.some((turn) => turn.role === "user") ||
        !ctx.shellReviewContext
      )
        throw new Error("Missing review context");
      return {
        payload: JSON.stringify({
          command,
          description,
          execution: shellExecutionGuidance(process.platform, ctx.appPath),
          recentTurns,
          ...ctx.shellReviewContext,
        }),
        tools: {
          inspect_app_path: buildShellInspectionTool(ctx.appPath, signal),
        },
      };
    },
  });
}
