/**
 * In-process MCP bridge exposing a small, validated set of Dyad operations
 * to Claude Code.
 *
 * The CLI is started with `--mcp-config` pointing at an `sdk`-type server
 * named `dyad`; every JSON-RPC message for it arrives as an `mcp_message`
 * control request over stdout and is answered over stdin. No socket, no
 * child process, no token: the bridge lives inside the Dyad main process and
 * is bound to exactly one app/chat/turn.
 *
 * Every tool is backed by an existing Dyad service and keeps that service's
 * locks, approval requirements, and read-only guards. Nothing here accepts an
 * arbitrary command.
 */
import type { IpcMainInvokeEvent } from "electron";
import log from "electron-log";
import { z } from "zod";
import { DyadError, DyadErrorKind, isDyadError } from "@/errors/dyad_error";
import {
  appOperationCoordinator,
  readAppResource,
} from "@/ipc/services/app_operation_coordinator";
import { appRunActorService } from "@/ipc/services/app_run_actor_service";
import {
  ExecuteAddDependencyError,
  installPackages,
} from "@/ipc/processors/executeAddDependency";
import { runTypeScriptCheck } from "@/ipc/processors/tsc";
import { runAppTestsWithIsolation } from "@/ipc/handlers/tests_handlers";
import { broadcastToRegisteredWindows } from "@/ipc/utils/window_broadcast";
import { getLogs } from "@/lib/log_store";
import { readSettings } from "@/main/settings";
import type {
  ConsoleEntry,
  ProblemReport,
  RunAppTestsResult,
} from "@/ipc/types";
import { escapeXmlAttr, escapeXmlContent } from "../../shared/xmlEscape";
import type { ChatBackendTurnMode } from "@/chat_backend/backend";
import {
  BRIDGE_TOOL_CONSENT_POLICIES,
  CLAUDE_CODE_MCP_SERVER_NAME,
  getBridgeToolNamesForMode,
} from "./permission_policy";

const logger = log.scope("claude_code_mcp_bridge");

export const DYAD_MCP_BRIDGE_VERSION = "1.0.0";

export interface DyadMcpBridgeContext {
  event: IpcMainInvokeEvent;
  appId: number;
  appPath: string;
  chatId: number;
  mode: ChatBackendTurnMode;
  signal: AbortSignal;
  testingEnabled: boolean;
  /** Emit a completed Dyad tool card into the chat transcript. */
  onToolCard: (xml: string) => void;
  onWarning: (message: string) => void;
}

interface JsonRpcRequest {
  jsonrpc?: "2.0";
  id?: number | string;
  method: string;
  params?: unknown;
}

type JsonRpcResponse =
  | { jsonrpc: "2.0"; id: number | string | null; result: unknown }
  | {
      jsonrpc: "2.0";
      id: number | string | null;
      error: { code: number; message: string; data?: unknown };
    };

interface BridgeTool<TArgs> {
  name: string;
  description: string;
  inputSchema: z.ZodType<TArgs>;
  execute: (args: TArgs, ctx: DyadMcpBridgeContext) => Promise<string>;
}

const NPM_SPEC_MAX_LENGTH = 214;

const addDependencySchema = z.object({
  packages: z
    .array(
      z
        .string()
        .trim()
        .min(1)
        .max(NPM_SPEC_MAX_LENGTH)
        .refine((spec) => !/[\s<>|;&`$(){}]/.test(spec), {
          message:
            "Package specs cannot contain whitespace or shell characters",
        })
        .refine(
          (spec) =>
            !/^(https?:|git\+|git:|github:|file:|link:|workspace:|\.|\/)/i.test(
              spec,
            ),
          { message: "Only registry package specs are allowed" },
        ),
    )
    .min(1)
    .max(25)
    .describe(
      "npm package names or registry version specs (for example `zod` or `zod@^4`). Only registry packages are allowed.",
    ),
});

const addDependencyTool: BridgeTool<z.infer<typeof addDependencySchema>> = {
  name: "add_dependency",
  description:
    "Install or refresh npm packages in the current app using Dyad's validated installer. A bare package name preserves an existing version constraint; use package@latest to upgrade explicitly. Only registry packages are accepted; no scripts or arbitrary commands run.",
  inputSchema: addDependencySchema,
  execute: async (args, ctx) => {
    const packagesAttr = escapeXmlAttr(args.packages.join(" "));
    try {
      const result = await appOperationCoordinator.run(
        {
          appId: ctx.appId,
          operation: "install Claude Code dependencies",
          resources: [readAppResource("app-path"), "repository-worktree"],
          refuseWhenRecording: "install dependencies",
        },
        () =>
          installPackages({ packages: args.packages, appPath: ctx.appPath }),
      );
      for (const warning of result.warningMessages) {
        ctx.onWarning(warning);
      }
      ctx.onToolCard(
        `<dyad-add-dependency packages="${packagesAttr}">${escapeXmlContent(result.installResults)}</dyad-add-dependency>`,
      );
      return `Successfully installed or updated ${args.packages.join(", ")}\n\n${result.installResults}`;
    } catch (error) {
      if (error instanceof ExecuteAddDependencyError) {
        for (const warning of error.warningMessages) {
          ctx.onWarning(warning);
        }
        ctx.onToolCard(
          `<dyad-add-dependency packages="${packagesAttr}">${escapeXmlContent(error.installResults || error.displayDetails)}</dyad-add-dependency>`,
        );
        throw new DyadError(
          `Dependency installation failed: ${error.displaySummary}\n${error.displayDetails}`,
          DyadErrorKind.External,
        );
      }
      throw error;
    }
  },
};

const runTypeChecksSchema = z.object({
  paths: z
    .array(z.string().trim().min(1).max(1_024))
    .max(50)
    .optional()
    .describe(
      "Optional relative file paths to focus the report on. The whole project is always checked.",
    ),
});

function formatProblemReport(
  report: ProblemReport,
  paths: string[] | undefined,
): { text: string; title: string; state: "finished" | "warning" } {
  const outcome =
    report.outcome ?? (report.problems.length === 0 ? "passed" : "errors");
  const normalizedPaths = (paths ?? []).map((candidate) =>
    candidate.replace(/\\/g, "/").replace(/^\.\//, ""),
  );
  const matching =
    normalizedPaths.length > 0
      ? report.problems.filter((problem) =>
          normalizedPaths.some((candidate) =>
            problem.file.replace(/\\/g, "/").endsWith(candidate),
          ),
        )
      : report.problems;
  const lines = matching
    .slice(0, 100)
    .map(
      (problem) =>
        `${problem.file}:${problem.line}:${problem.column} - TS${problem.code}: ${problem.message}`,
    );
  if (outcome === "incomplete") {
    return {
      title: "Type check could not complete",
      state: "warning",
      text: `Type checking could not complete because TypeScript rejected the project configuration:\n\n${lines.join("\n")}`,
    };
  }
  if (report.problems.length === 0) {
    return {
      title: "Type check passed",
      state: "finished",
      text: "Type check passed",
    };
  }
  const header =
    normalizedPaths.length > 0
      ? `${matching.length} of ${report.problems.length} type error(s) match the requested paths:`
      : `${report.problems.length} type error(s):`;
  return {
    title: `Type check found ${report.problems.length} error(s)`,
    state: "finished",
    text: `${header}\n${lines.join("\n")}${
      matching.length > 100 ? `\n... ${matching.length - 100} more` : ""
    }`,
  };
}

const runTypeChecksTool: BridgeTool<z.infer<typeof runTypeChecksSchema>> = {
  name: "run_type_checks",
  description:
    "Run the app's TypeScript compiler check through Dyad and return the diagnostics. Use after editing TypeScript files to verify they compile.",
  inputSchema: runTypeChecksSchema,
  execute: async (args, ctx) => {
    let report: ProblemReport;
    try {
      report = await runTypeScriptCheck({ appPath: ctx.appPath });
    } catch (error) {
      if (isDyadError(error) && error.kind === DyadErrorKind.Precondition) {
        broadcastToRegisteredWindows(
          ctx.event.sender,
          "agent-tool:problems-update",
          { appId: ctx.appId, problems: { problems: [] } },
        );
        ctx.onToolCard(
          `<dyad-output type="warning" message="${escapeXmlAttr("Type checking unavailable")}">\n${escapeXmlContent(error.message)}\n</dyad-output>`,
        );
        return `Type checking is unavailable: ${error.message}`;
      }
      throw error;
    }
    broadcastToRegisteredWindows(
      ctx.event.sender,
      "agent-tool:problems-update",
      { appId: ctx.appId, problems: report },
    );
    const formatted = formatProblemReport(report, args.paths);
    ctx.onToolCard(
      `<dyad-status title="${escapeXmlAttr(formatted.title)}" state="${formatted.state}">\n${escapeXmlContent(formatted.text)}\n</dyad-status>`,
    );
    return formatted.text;
  },
};

const runTestsSchema = z.object({
  testFile: z
    .string()
    .trim()
    .min(1)
    .max(512)
    .describe(
      'Spec path relative to the app root, for example "e2e-tests/checkout.spec.ts".',
    ),
  grep: z
    .string()
    .trim()
    .min(1)
    .max(256)
    .optional()
    .describe("Optional regex matched against test titles to narrow the run."),
});

function formatTestResult(result: RunAppTestsResult): {
  text: string;
  title: string;
  state: "finished" | "warning";
} {
  if (result.infraError) {
    return {
      title: "Test run could not complete",
      state: "warning",
      text: `Test run could not complete (infrastructure, not a test failure): ${result.infraError.message}`,
    };
  }
  if (result.results.length === 0) {
    return {
      title: "No tests ran",
      state: "warning",
      text: "No runnable tests matched the request.",
    };
  }
  const lines: string[] = [];
  let failed = 0;
  for (const file of result.results) {
    lines.push(`${file.file}: ${file.status}`);
    for (const test of file.tests ?? []) {
      lines.push(`  - ${test.title}: ${test.status}`);
      if (test.error) {
        lines.push(`    ${test.error.split("\n").slice(0, 20).join("\n    ")}`);
      }
      if (test.status === "failed") failed += 1;
    }
    if (file.error) {
      lines.push(`  ${file.error.split("\n").slice(0, 20).join("\n  ")}`);
    }
    if (file.status === "failed" && !(file.tests ?? []).length) failed += 1;
    if (file.screenshotPath) {
      lines.push(`  screenshot: ${file.screenshotPath}`);
    }
  }
  return {
    title: failed > 0 ? `Tests failed (${failed})` : "Tests passed",
    state: "finished",
    text: lines.join("\n"),
  };
}

const runTestsTool: BridgeTool<z.infer<typeof runTestsSchema>> = {
  name: "run_tests",
  description:
    "Run one of the app's Playwright specs through Dyad's test runner (with database isolation when configured) and return the results. Requires the app preview to be running.",
  inputSchema: runTestsSchema,
  execute: async (args, ctx) => {
    if (!ctx.testingEnabled) {
      throw new DyadError(
        "Testing is not enabled for this app.",
        DyadErrorKind.Precondition,
      );
    }
    const settings = readSettings();
    const result = await runAppTestsWithIsolation({
      event: ctx.event,
      appId: ctx.appId,
      testFile: args.testFile,
      grep: args.grep,
      source: "agent",
      headed: settings.testHeaded ?? false,
      parallel: (settings.testParallel ?? false) && !args.grep,
      slowMo: settings.testSlowMo ?? false,
      externalSignal: ctx.signal,
      preview:
        (settings.enableTestRunInPreview ?? false) &&
        (settings.testHeaded ?? false),
    });
    const formatted = formatTestResult(result);
    ctx.onToolCard(
      `<dyad-status title="${escapeXmlAttr(formatted.title)}" state="${formatted.state}">\n${escapeXmlContent(formatted.text)}\n</dyad-status>`,
    );
    return formatted.text;
  },
};

const readLogsSchema = z.object({
  type: z
    .enum(["all", "server", "client", "edge-function", "network-requests"])
    .optional(),
  level: z.enum(["all", "info", "warn", "error"]).optional(),
  searchTerm: z.string().trim().max(200).optional(),
  limit: z.number().int().min(1).max(200).optional(),
});

function formatLogs(entries: ConsoleEntry[]): string {
  return entries
    .map((entry) => {
      if (entry.runtimeBoundary) {
        return `--- app ${entry.runtimeBoundary} ---`;
      }
      const timestamp = new Date(entry.timestamp).toISOString();
      const source = entry.sourceName ? ` [${entry.sourceName}]` : "";
      return `[${timestamp}] [${entry.level}] [${entry.type}]${source} ${entry.message}`;
    })
    .join("\n");
}

const readLogsTool: BridgeTool<z.infer<typeof readLogsSchema>> = {
  name: "read_logs",
  description:
    "Read the running app's recent logs (last 5 minutes): server output, browser console, edge functions, and network requests. Logs are a snapshot at call time.",
  inputSchema: readLogsSchema,
  execute: async (args, ctx) => {
    const cutoff = Date.now() - 5 * 60 * 1000;
    let filtered = getLogs(ctx.appId).filter(
      (entry) => entry.timestamp >= cutoff,
    );
    if (args.type && args.type !== "all") {
      filtered = filtered.filter(
        (entry) =>
          entry.runtimeBoundary !== undefined || entry.type === args.type,
      );
    }
    if (args.level && args.level !== "all") {
      filtered = filtered.filter(
        (entry) =>
          entry.runtimeBoundary !== undefined || entry.level === args.level,
      );
    }
    if (args.searchTerm) {
      const term = args.searchTerm.toLowerCase();
      filtered = filtered.filter(
        (entry) =>
          entry.runtimeBoundary !== undefined ||
          entry.message.toLowerCase().includes(term),
      );
    }
    filtered.sort((a, b) => a.timestamp - b.timestamp);
    const limit = Math.min(args.limit ?? 50, 200);
    const recent = filtered
      .filter((entry) => !entry.runtimeBoundary)
      .slice(-limit);
    const recentSet = new Set(recent);
    const retained = filtered.filter(
      (entry) => entry.runtimeBoundary !== undefined || recentSet.has(entry),
    );
    const text =
      recent.length === 0
        ? "No logs found matching the specified filters."
        : `Showing ${recent.length} log entries (last 5 minutes)\n${formatLogs(retained)}`;
    const summary = [
      "Time: last 5 minutes",
      args.type && args.type !== "all" ? `Type: ${args.type}` : null,
      args.level && args.level !== "all" ? `Level: ${args.level}` : null,
      args.searchTerm ? `Search: "${args.searchTerm}"` : null,
    ]
      .filter(Boolean)
      .join(" | ");
    ctx.onToolCard(
      `<dyad-read-logs>\n${escapeXmlContent(summary)}\n${escapeXmlContent(text)}\n</dyad-read-logs>`,
    );
    return text;
  },
};

const restartAppSchema = z.object({});

const restartAppTool: BridgeTool<z.infer<typeof restartAppSchema>> = {
  name: "restart_app",
  description:
    "Restart the current app's development server through Dyad (no dependency reinstall). Only use when the server is stopped, stale, or a config change requires it.",
  inputSchema: restartAppSchema,
  execute: async (_args, ctx) => {
    if (ctx.signal.aborted) {
      throw new DyadError(
        "The restart was cancelled before it started",
        DyadErrorKind.UserCancelled,
      );
    }
    await appRunActorService.executeExternalLifecycle({
      appId: ctx.appId,
      operation: "restart",
      abortSignal: ctx.signal,
    });
    ctx.onToolCard(
      `<dyad-status title="App restarted" state="finished"></dyad-status>`,
    );
    return "The app restarted successfully.";
  },
};

const ALL_BRIDGE_TOOLS: ReadonlyArray<BridgeTool<any>> = [
  addDependencyTool,
  runTypeChecksTool,
  runTestsTool,
  readLogsTool,
  restartAppTool,
];

// Every tool must have a consent policy; a typo here would silently expose a
// tool without permission mapping.
for (const tool of ALL_BRIDGE_TOOLS) {
  if (!BRIDGE_TOOL_CONSENT_POLICIES[tool.name]) {
    throw new Error(`Missing consent policy for bridge tool ${tool.name}`);
  }
}

export function getDyadBridgeTools(mode: ChatBackendTurnMode) {
  const allowed = new Set(getBridgeToolNamesForMode(mode));
  return ALL_BRIDGE_TOOLS.filter((tool) => allowed.has(tool.name));
}

export function buildDyadMcpConfig(): { mcpServers: Record<string, unknown> } {
  return {
    mcpServers: {
      [CLAUDE_CODE_MCP_SERVER_NAME]: {
        type: "sdk",
        name: CLAUDE_CODE_MCP_SERVER_NAME,
      },
    },
  };
}

function toJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const json = z.toJSONSchema(schema, { target: "draft-7" }) as Record<
    string,
    unknown
  >;
  delete json.$schema;
  return json;
}

function rpcError(
  id: number | string | null,
  code: number,
  message: string,
  data?: unknown,
): JsonRpcResponse {
  return { jsonrpc: "2.0", id, error: { code, message, data } };
}

/**
 * Dispatch one JSON-RPC message for the `dyad` server. Returns null for
 * notifications (no response expected).
 */
export async function handleDyadMcpMessage(
  message: JsonRpcRequest,
  ctx: DyadMcpBridgeContext,
): Promise<JsonRpcResponse | null> {
  const id = message.id ?? null;
  const isNotification = message.id === undefined;
  const tools = getDyadBridgeTools(ctx.mode);

  switch (message.method) {
    case "initialize": {
      const params = (message.params ?? {}) as { protocolVersion?: string };
      return {
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: params.protocolVersion ?? "2025-06-18",
          capabilities: { tools: {} },
          serverInfo: {
            name: CLAUDE_CODE_MCP_SERVER_NAME,
            version: DYAD_MCP_BRIDGE_VERSION,
          },
        },
      };
    }
    case "notifications/initialized":
    case "notifications/cancelled":
      return null;
    case "ping":
      return { jsonrpc: "2.0", id, result: {} };
    case "tools/list":
      return {
        jsonrpc: "2.0",
        id,
        result: {
          tools: tools.map((tool) => ({
            name: tool.name,
            description: tool.description,
            inputSchema: toJsonSchema(tool.inputSchema),
          })),
        },
      };
    case "tools/call": {
      const params = (message.params ?? {}) as {
        name?: unknown;
        arguments?: unknown;
      };
      const tool = tools.find((candidate) => candidate.name === params.name);
      if (!tool) {
        return rpcError(id, -32602, `Unknown tool: ${String(params.name)}`);
      }
      const parsedArgs = tool.inputSchema.safeParse(params.arguments ?? {});
      if (!parsedArgs.success) {
        return {
          jsonrpc: "2.0",
          id,
          result: {
            isError: true,
            content: [
              {
                type: "text",
                text: `Invalid arguments for ${tool.name}: ${parsedArgs.error.issues
                  .map(
                    (issue) =>
                      `${issue.path.join(".") || "input"}: ${issue.message}`,
                  )
                  .join("; ")}`,
              },
            ],
          },
        };
      }
      if (ctx.signal.aborted) {
        return {
          jsonrpc: "2.0",
          id,
          result: {
            isError: true,
            content: [{ type: "text", text: "The turn was cancelled." }],
          },
        };
      }
      try {
        const text = await tool.execute(parsedArgs.data, ctx);
        return {
          jsonrpc: "2.0",
          id,
          result: { content: [{ type: "text", text }] },
        };
      } catch (error) {
        const messageText =
          error instanceof Error ? error.message : String(error);
        logger.warn(`Bridge tool ${tool.name} failed: ${messageText}`);
        return {
          jsonrpc: "2.0",
          id,
          result: {
            isError: true,
            content: [
              { type: "text", text: `${tool.name} failed: ${messageText}` },
            ],
          },
        };
      }
    }
    default:
      if (isNotification) {
        return null;
      }
      return rpcError(id, -32601, `Method not found: ${message.method}`);
  }
}
