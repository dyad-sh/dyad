import { promises as fs } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { tool } from "ai";
import { z } from "zod";
import {
  reviewToolAction,
  SHELL_REVIEW_TIMEOUT_MS,
  ShellReviewCatalogTooLargeError,
} from "./tool_safety_reviewer";
import { getRecentTurnsForConsent } from "./mcp_consent_context";
import { buildShellReviewPrompt } from "@/prompts/shell_review_policy";
import { shellExecutionGuidance } from "@/shared/shell_capability";
import type { AgentContext } from "./tools/types";
import { readSettings } from "@/main/settings";

function isForbiddenInspectionSegment(part: string): boolean {
  return (
    part === ".." ||
    /^\.env(?:\.|$)|secret|credential|^\.(?:git|dyad|ssh|aws|npmrc|pypirc)$|^id_(?:rsa|ed25519)$|\.(?:pem|key)$/i.test(
      part,
    )
  );
}

type InspectionEvidence = Map<
  string,
  { target: string; bytes: number; modified: number; hash?: string }
>;

export async function revalidateShellInspectionEvidence(
  appPath: string,
  evidence: InspectionEvidence,
): Promise<boolean> {
  try {
    for (const [relative, entry] of evidence) {
      const target = await fs.realpath(path.resolve(appPath, relative));
      const stat = await fs.stat(target);
      if (stat.isFile() && stat.nlink !== 1)
        throw new Error("Inspection requires a file without hard links");
      if (
        target !== entry.target ||
        stat.size !== entry.bytes ||
        stat.mtimeMs !== entry.modified
      )
        return false;
      if (entry.hash) {
        if (!stat.isFile() || stat.size > 24_000) return false;
        const file = await fs.open(target, "r");
        try {
          const buffer = Buffer.alloc(24_001);
          const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
          if (
            createHash("sha256")
              .update(buffer.subarray(0, bytesRead))
              .digest("hex") !== entry.hash
          )
            return false;
        } finally {
          await file.close();
        }
      }
    }
    return true;
  } catch {
    return false;
  }
}

export function buildShellInspectionTool(
  appPath: string,
  signal: AbortSignal,
  evidence?: InspectionEvidence,
) {
  let reads = 0;
  return tool({
    description:
      "Read a small ordinary app file or inspect path metadata. Paths must be relative to the starting app directory (e.g. scripts/transform.js), never absolute. Use read:true to inspect script contents in one call. No command execution. Secret targets and paths outside the app are unavailable.",
    inputSchema: z.object({
      path: z
        .string()
        .max(1024)
        .describe(
          "App-relative path, such as scripts/transform.js. Absolute paths are rejected.",
        ),
      read: z.boolean().default(false),
    }),
    execute: async ({ path: relative, read }) => {
      signal.throwIfAborted();
      if (++reads > 6) throw new Error("Inspection budget exhausted");
      if (
        path.isAbsolute(relative) ||
        path.win32.isAbsolute(relative) ||
        relative.split(/[\\/]/).some(isForbiddenInspectionSegment)
      ) {
        throw new Error("Inspection path is unavailable");
      }
      const root = await fs.realpath(appPath);
      const target = await fs.realpath(path.resolve(root, relative));
      const resolvedRelative = path.relative(root, target);
      if (
        resolvedRelative.startsWith("..") ||
        path.isAbsolute(resolvedRelative) ||
        resolvedRelative.split(path.sep).some(isForbiddenInspectionSegment)
      )
        throw new Error("Inspection path is unavailable");
      const stat = await fs.stat(target);
      const inspected = { target, bytes: stat.size, modified: stat.mtimeMs };
      if (stat.isFile() && stat.nlink !== 1)
        throw new Error("Inspection requires a file without hard links");
      // Metadata-only reinspection must never discard a previously read hash.
      if (!read && !evidence?.has(relative)) evidence?.set(relative, inspected);
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
        const opened = await file.stat();
        // Check the actual descriptor before reading; an alias can change during open.
        if (
          !opened.isFile() ||
          opened.nlink !== 1 ||
          opened.size > 24_000 ||
          opened.dev !== stat.dev ||
          opened.ino !== stat.ino
        )
          throw new Error("Inspection file changed or has hard links");
        const buffer = Buffer.alloc(24_001);
        const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
        signal.throwIfAborted();
        if (bytesRead > 24_000)
          throw new Error("Inspection file exceeds budget");
        evidence?.set(relative, {
          ...inspected,
          hash: createHash("sha256")
            .update(buffer.subarray(0, bytesRead))
            .digest("hex"),
        });
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

/** Keep every tool's availability visible while bounding untrusted evidence. */
export function boundShellReviewContext(
  context: NonNullable<AgentContext["shellReviewContext"]>,
) {
  const cap = (text: string, size: number) =>
    text.length > size ? `${text.slice(0, size)}…[truncated]` : text;
  let tools = context.tools.map((entry) => ({
    name: entry.name,
    available: entry.available,
    description: cap(entry.description, 240),
  }));
  // Degrade descriptions first; never omit names or availability of alternatives.
  for (const size of [120, 60, 0]) {
    if (JSON.stringify(tools).length <= 40_000) break;
    tools = context.tools.map((entry) => ({
      name: entry.name,
      available: entry.available,
      description:
        entry.available && size > 0 ? cap(entry.description, size) : "",
    }));
  }
  if (JSON.stringify(tools).length > 40_000)
    throw new ShellReviewCatalogTooLargeError();
  return {
    tools,
    history: context.history.slice(-6).map((entry) => ({
      tool: entry.tool,
      args: cap(entry.args, 1000),
      outcome:
        entry.outcome === "execution_failed"
          ? "execution_failed"
          : entry.outcome === "returned"
            ? "returned"
            : "not_executed_or_denied",
    })),
    contextNotice:
      "Descriptions and evidence may be truncated. Missing evidence cannot establish authorization or a failed dedicated-tool execution.",
  };
}

export async function reviewShellCommand(
  command: string,
  description: string,
  ctx: AgentContext,
) {
  const evidence: InspectionEvidence = new Map();
  const result = await reviewToolAction({
    settings: ctx.inferenceSettings ?? readSettings(),
    system: buildShellReviewPrompt(),
    fallback: "block",
    timeoutMs: SHELL_REVIEW_TIMEOUT_MS,
    signal: ctx.abortSignal,
    prepare: async (signal) => {
      const recentTurns = await getRecentTurnsForConsent(ctx.chatId);
      ctx.refreshShellReviewTools?.();
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
          ...boundShellReviewContext(ctx.shellReviewContext),
        }),
        tools: {
          inspect_app_path: buildShellInspectionTool(
            ctx.appPath,
            signal,
            evidence,
          ),
        },
      };
    },
  });
  return {
    ...result,
    revalidateInspection: () =>
      revalidateShellInspectionEvidence(ctx.appPath, evidence),
  };
}
