import { z } from "zod";
import {
  executeSandboxScriptInProcess,
  isSandboxSupportedPlatform,
} from "@/ipc/utils/sandbox/execution";
import { runSandboxScript } from "@/ipc/utils/sandbox/runner";
import { buildSandboxCapabilitiesWithObserver } from "@/ipc/utils/sandbox/capabilities";
import { SANDBOX_SCRIPT_SOURCE_LIMIT_BYTES } from "@/ipc/utils/sandbox/limits";
import { DyadError, DyadErrorKind, isDyadError } from "@/errors/dyad_error";
import { sendTelemetryEvent } from "@/ipc/utils/telemetry";
import { DYAD_MEDIA_DIR_NAME } from "@/ipc/utils/media_path_utils";
import { readSettings } from "@/main/settings";
import type { UserSettings } from "@/lib/schemas";
import {
  AgentContext,
  escapeXmlAttr,
  escapeXmlContent,
  ToolDefinition,
} from "./types";
import {
  collectMcpToolDefs,
  buildMcpTypeDefsBlock,
  buildMcpCapabilityMap,
  type McpToolDef,
} from "./mcp_type_defs";

const executeSandboxScriptSchema = z.object({
  script: z
    .string()
    .max(SANDBOX_SCRIPT_SOURCE_LIMIT_BYTES)
    .describe("Sandboxed JavaScript subset source code to execute."),
  description: z
    .string()
    .max(160)
    .optional()
    .describe("One-line human-readable summary of what the script does."),
  execution_thread: z
    .enum(["main", "worker"])
    .optional()
    .default("main")
    .describe(
      "Where to run the script. Default 'main' runs in-process and is " +
        "the only thread that exposes MCP tools — use it for any script " +
        "that calls MCP host functions, and for small / fast operations. " +
        "Use 'worker' for compute-heavy work (parsing multi-MB attachments, " +
        "large aggregations, anything that might take more than a few hundred " +
        "milliseconds) so chat streaming and other main-process work isn't " +
        "stalled. MCP host functions are NOT available on the worker thread.",
    ),
});

type ExecuteSandboxScriptArgs = z.infer<typeof executeSandboxScriptSchema>;

export function isSandboxScriptExecutionEnabled(
  settings: Pick<UserSettings, "enableSandboxScriptExecution"> | undefined,
): boolean {
  return !!settings?.enableSandboxScriptExecution;
}

function isAttachmentHostCallPath(path: string | undefined): boolean {
  if (!path) {
    return false;
  }
  if (
    path === "attachments" ||
    path === "attachments:" ||
    path.startsWith("attachments:")
  ) {
    return true;
  }
  const normalized = path.replace(/\\/g, "/");
  return (
    normalized === DYAD_MEDIA_DIR_NAME ||
    normalized.startsWith(`${DYAD_MEDIA_DIR_NAME}/`)
  );
}

function buildSandboxFailureMessage(params: {
  script: string;
  errorMessage: string;
}): string {
  return [
    "This script contains unsupported syntax.",
    "",
    "Script:",
    params.script,
    "",
    "Original error:",
    params.errorMessage,
  ].join("\n");
}

function buildScriptXml(params: {
  args: ExecuteSandboxScriptArgs;
  output: string;
  truncated: boolean;
  fullOutputPath?: string;
  executionMs: number;
}): string {
  const payload = JSON.stringify(
    {
      script: params.args.script,
      output: params.output,
    },
    null,
    2,
  );
  const attrs = [
    `description="${escapeXmlAttr(params.args.description ?? "Ran a script")}"`,
    `state="finished"`,
    `truncated="${params.truncated ? "true" : "false"}"`,
    `execution-ms="${escapeXmlAttr(String(params.executionMs))}"`,
  ];
  if (params.fullOutputPath) {
    attrs.push(`full-output-path="${escapeXmlAttr(params.fullOutputPath)}"`);
  }
  return `<dyad-script ${attrs.join(" ")}>${escapeXmlContent(payload)}</dyad-script>`;
}

// File-inspection-only base. Used as-is when no MCP servers are
// enabled (or in read-only / plan mode where the sandbox cannot reach
// MCP), and as the lead-in to the MCP-augmented description otherwise.
// Keep MCP-specific framing out of this block — if it lands in front
// of the model when MCP is off, the model will write calls to host
// functions that don't exist.
const FILES_ONLY_PREAMBLE = `Run a small program written in a strict, sandboxed subset of JavaScript (MustardScript) to inspect files.

Use this when you need to slice, search, count, aggregate, or summarize file contents before answering. Return only the concise value you need.

Supported language surface:
- let/const, functions, closures, arrow functions, async/await, promises, arrays, plain objects, Map, Set, if/switch, loops, break/continue, try/catch/finally, throw, template literals, destructuring, optional chaining, nullish coalescing, JSON, Math, and conservative Array/String/Object/Date/Intl/RegExp helpers.
- Top-level await is supported. Top-level return is not supported; return the final expression value instead, e.g. \`const text = await read_file("attachments:data.csv"); text.length;\`.
- The script has no ambient authority. It can only act through the host functions below.

Recommendations:
- Avoid defining nested helper functions in the main function.

Unsupported / unavailable:
- No var, import/export, require, CommonJS, npm packages, Node APIs, browser/DOM APIs, process, module, exports, global, environment variables, subprocesses, network/fetch, fetch, timers, setTimeout, setInterval, eval, Function constructor, with, classes, generators, custom iterator authoring, Symbols, WeakMap, WeakSet, typed arrays, ArrayBuffer, shared memory, atomics, Proxy, accessors, full prototype/property-descriptor semantics, or arbitrary filesystem access.
- String.prototype.localeCompare is not supported; compare with <, >, or === instead.
- \`console.*\` is not available.
- Unsupported syntax or unsupported built-in behavior fails closed with an error. Rewrite using simpler JavaScript when that happens.

Avoid returning shared references:

\`\`\`
const row = { key: "x", total: 1 };
({ a: row, b: row }); // rejected
\`\`\`

Use cloned/plain rows instead:

\`\`\`
const row = { key: "x", total: 1 };
({
  a: { key: row.key, total: row.total },
  b: { key: row.key, total: row.total }
});
\`\`\`

Execution thread:
- 'main' (default) runs in-process. Use for small / fast scripts.
- 'worker' runs on a separate worker thread so chat streaming and other main-process work stay responsive. Use when the script is compute-heavy (parsing multi-MB CSVs, large aggregations).

Host functions:
\`\`\`ts
type ReadFileOptions = {
  start?: number; // zero-indexed byte offset
  length?: number; // max bytes to read
  encoding?: "utf8" | "base64";
};

type FileStats = {
  size: number;
  isText: boolean;
  mtime: string; // ISO timestamp
};

declare function read_file(
  path: string,
  options?: ReadFileOptions,
): Promise<string>;

declare function list_files(dir?: "." | "attachments:" | string): Promise<string[]>;

declare function file_stats(path: string): Promise<FileStats>;
\`\`\`

Paths are app-relative (including \`.dyad/media/<stored-name>\`), or attachment paths like attachments:filename.ext. Prefer range reads, filtering, aggregation, and small summaries over returning entire files.`;

function buildMcpAddendum(typeDefsBlock: string): string {
  return `

MCP tools can also be invoked from inside the script. Use this when you need to call one or more MCP tools (optionally chaining their results, or combining them with file reads) before answering.
- Each MCP tool invocation may trigger a user consent prompt. A denied call throws.
- MCP host functions are only available on the 'main' execution thread. They are NOT available on the 'worker' thread — if you need both heavy compute and MCP calls, split into two scripts (worker for the compute, then main for the MCP follow-up).

MCP host functions (TypeScript declarations):
\`\`\`ts
${typeDefsBlock}
\`\`\``;
}

// Search-mode addendum: used when the `enableMcpToolSearch` experiment is on.
// The per-tool declarations are NOT listed here to keep context lean; the
// model discovers them via `search_mcp_tools` and then calls the returned
// host functions from inside the script.
function buildServerInventory(defs: McpToolDef[]): string {
  const counts = new Map<string, number>();
  for (const def of defs) {
    const name = def.serverName;
    if (!name) continue;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  if (counts.size === 0) return "";
  const list = [...counts.entries()]
    .map(([name, n]) => `${name} (${n} tool${n === 1 ? "" : "s"})`)
    .join(", ");
  return `\nConnected MCP servers: ${list}. Search within one with the \`server\` param, or across all by omitting it.`;
}

function buildMcpSearchAddendum(defs: McpToolDef[]): string {
  return `

MCP tools can also be invoked from inside the script. To use one:
1. Call the \`search_mcp_tools\` tool with keywords (optionally a \`server\`) to get the TypeScript declarations of the tools you need.
2. Call those declared host functions inside this script, exactly as declared.
${buildServerInventory(defs)}
- Each MCP tool invocation may trigger a user consent prompt. A denied call throws.
- MCP host functions are only available on the 'main' execution thread. They are NOT available on the 'worker' thread — if you need both heavy compute and MCP calls, split into two scripts (worker for the compute, then main for the MCP follow-up).`;
}

/**
 * Build the full tool description, appending the MCP host-function
 * declarations and usage notes when any MCP server is enabled. The
 * caller passes in the per-turn defs collected by the local-agent
 * handler; the standalone `collectMcpToolDefs()` fallback is only for
 * callers that don't go through the handler. When no MCP defs are
 * available the description carries no MCP framing at all, so the
 * model does not try to call host functions that don't exist (e.g. in
 * read-only / plan-only turns).
 */
export async function buildExecuteSandboxScriptDescription(
  precomputedDefs?: McpToolDef[],
  options?: { useSearch?: boolean },
): Promise<string> {
  const defs = precomputedDefs ?? (await collectMcpToolDefs());
  if (defs.length === 0) {
    return FILES_ONLY_PREAMBLE;
  }
  // Search mode (experiment on): point the model at `search_mcp_tools`
  // instead of inlining every tool's declarations. The full per-tool block is
  // only embedded when search is off.
  if (options?.useSearch) {
    return FILES_ONLY_PREAMBLE + buildMcpSearchAddendum(defs);
  }
  return FILES_ONLY_PREAMBLE + buildMcpAddendum(buildMcpTypeDefsBlock(defs));
}

export const executeSandboxScriptTool: ToolDefinition<ExecuteSandboxScriptArgs> =
  {
    name: "execute_sandbox_script",
    description:
      "Run a MustardScript program in a sandbox. Supports file inspection and MCP tool calls.",
    inputSchema: executeSandboxScriptSchema,
    defaultConsent: "always",

    isEnabled: () =>
      isSandboxSupportedPlatform() &&
      isSandboxScriptExecutionEnabled(readSettings()),

    getConsentPreview: (args) =>
      args.description?.trim() || "Run a sandboxed script",

    execute: async (args: ExecuteSandboxScriptArgs, ctx: AgentContext) => {
      const executionThread = args.execution_thread ?? "main";
      const observeHostCall = ({ path }: { path?: string }) => {
        if (isAttachmentHostCallPath(path)) {
          ctx.onAttachmentAccess?.();
        }
      };
      try {
        const result =
          executionThread === "worker"
            ? // Worker thread builds its own capability map inside the worker;
              // MCP host functions are intentionally not exposed on this path
              // because the MCP client + consent flow live on the main thread.
              // Splitting heavy compute (worker) from MCP follow-up (main) is
              // documented in the tool prompt.
              await runSandboxScript({
                appPath: ctx.appPath,
                script: args.script,
                onHostCall: observeHostCall,
              })
            : await runInMainThread({ args, ctx, observeHostCall });

        ctx.onXmlComplete(
          buildScriptXml({
            args,
            output: result.value,
            truncated: result.truncated,
            fullOutputPath: result.fullOutputPath,
            executionMs: result.executionMs,
          }),
        );

        sendTelemetryEvent("sandbox.script.completed", {
          chatId: ctx.chatId,
          appId: ctx.appId,
          executionMs: result.executionMs,
          truncated: result.truncated,
          executionThread,
        });

        if (result.truncated) {
          sendTelemetryEvent("sandbox.script.truncated", {
            chatId: ctx.chatId,
            appId: ctx.appId,
            fullOutputPath: result.fullOutputPath,
            executionThread,
          });
        }

        return JSON.stringify(result);
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        sendTelemetryEvent(
          errorMessage.includes("timed out")
            ? "sandbox.script.timeout"
            : "sandbox.script.failed",
          {
            chatId: ctx.chatId,
            appId: ctx.appId,
            error: errorMessage,
            executionThread,
          },
        );
        throw new DyadError(
          buildSandboxFailureMessage({
            script: args.script,
            errorMessage,
          }),
          isDyadError(error) ? error.kind : DyadErrorKind.Validation,
        );
      }
    },
  };

/**
 * Run a sandbox script in the main process with both built-in file
 * host functions and (when enabled for the turn) MCP host functions
 * injected as capabilities. Extracted from `execute()` so the worker
 * path can stay a simple call to `runSandboxScript`.
 */
async function runInMainThread(params: {
  args: ExecuteSandboxScriptArgs;
  ctx: AgentContext;
  observeHostCall: (event: { path?: string }) => void;
}) {
  // Only inject MCP host functions when the caller has opted in for
  // this turn (set by `local_agent_handler`). Skipping here keeps
  // read-only and plan-mode turns from exposing MCP tools through
  // the sandbox even if the model invents a host-function name.
  //
  // The handler populates `ctx.mcpToolDefs` with the same defs used
  // to build the dynamic tool description, so the prompt and the
  // capability map can never disagree about which tools exist.
  const defs: McpToolDef[] = params.ctx.mcpToolsEnabled
    ? (params.ctx.mcpToolDefs ?? [])
    : [];
  const fileCaps = buildSandboxCapabilitiesWithObserver(
    params.ctx.appPath,
    params.observeHostCall,
  );
  const mcpCaps = buildMcpCapabilityMap({
    event: params.ctx.event,
    ctx: params.ctx,
    defs,
  });
  const capabilities = {
    ...(fileCaps as unknown as Record<string, (...args: unknown[]) => unknown>),
    ...mcpCaps,
  };

  return executeSandboxScriptInProcess({
    appPath: params.ctx.appPath,
    script: params.args.script,
    capabilities,
  });
}
