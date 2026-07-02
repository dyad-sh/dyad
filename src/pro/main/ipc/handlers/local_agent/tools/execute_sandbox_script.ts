import { z } from "zod";
import {
  executeSandboxScriptInProcess,
  isSandboxSupportedPlatform,
} from "@/ipc/utils/sandbox/execution";
import { runSandboxScript } from "@/ipc/utils/sandbox/runner";
import {
  assertAllowedGuestPath,
  buildSandboxCapabilitiesWithObserver,
} from "@/ipc/utils/sandbox/capabilities";
import { SANDBOX_SCRIPT_SOURCE_LIMIT_BYTES } from "@/ipc/utils/sandbox/limits";
import { DyadError, DyadErrorKind, isDyadError } from "@/errors/dyad_error";
import { sendTelemetryEvent } from "@/ipc/utils/telemetry";
import { DYAD_MEDIA_DIR_NAME } from "@/ipc/utils/media_path_utils";
import { readSettings } from "@/main/settings";
import type { UserSettings } from "@/lib/schemas";
import { writeFileTool } from "./write_file";
import {
  AgentContext,
  escapeXmlAttr,
  escapeXmlContent,
  ToolDefinition,
} from "./types";
import {
  collectMcpToolDefs,
  buildMcpTypeDefsBlock,
  buildMcpToolNameInventory,
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
        "the only thread that can expose main-thread-only host functions — " +
        "use it for scripts that call MCP host functions and for small / " +
        "fast operations. " +
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

function isWriteFileHostEnabled(): boolean {
  return readSettings().agentToolConsents?.write_file !== "never";
}

const WRITE_FILE_HOST_DECLARATIONS = `
declare function write_file(
  path: string,
  content: string,
  description?: string,
): Promise<string>;

declare function write_file(args: {
  path: string;
  content: string;
  description?: string;
}): Promise<string>;
`.trimEnd();

// Built-in sandbox host-function base. Used as-is when no MCP servers are
// enabled, and as the lead-in to the MCP-augmented description otherwise.
// Keep MCP-specific framing out of this block — if it lands in front
// of the model when MCP is off, the model will write calls to host
// functions that don't exist.
function buildBuiltInHostFunctionsPreamble({
  includeWriteFile,
}: {
  includeWriteFile: boolean;
}): string {
  return `Run a small program written in a strict, sandboxed subset of JavaScript (MustardScript) to inspect files.

Use this when you need to slice, search, count, aggregate, summarize file contents${includeWriteFile ? ", or write generated content to files" : ""} before answering. Return only the concise value you need.

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
- 'main' (default) runs in-process. Use for small / fast scripts${includeWriteFile ? ", write_file," : ""} and MCP calls.
- 'worker' runs on a separate worker thread so chat streaming and other main-process work stay responsive. Use when the script is compute-heavy (parsing multi-MB CSVs, large aggregations). The worker thread exposes read_file, list_files, and file_stats only; ${includeWriteFile ? "write_file and " : ""}MCP calls are not available.

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
${includeWriteFile ? WRITE_FILE_HOST_DECLARATIONS : ""}
\`\`\`

Paths are app-relative (including \`.dyad/media/<stored-name>\`), or attachment paths like attachments:filename.ext for read_file/list_files/file_stats.${includeWriteFile ? " write_file accepts app-relative paths only, not attachments: paths." : ""} Prefer range reads, filtering, aggregation, and small summaries over returning entire files.`;
}

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

// Search-mode addendum: used when the `enableMcpToolSearch` setting is on.
// Every tool is listed by NAME ONLY (no descriptions or schemas) so the model
// sees what exists without paying for the full declarations. To call a tool it
// pulls the full signature with `get_mcp_tool_schema` (when it recognizes the
// tool) or finds one with `search_mcp_tools` (when it doesn't).
//
// `hasGetSchemaTool` reflects whether `get_mcp_tool_schema` is actually
// registered this turn. A user can set it to `never` in tool permissions,
// which filters it out while search mode stays on; in that case the wording
// must not tell the model to call a tool that isn't available.
function buildMcpSearchAddendum(
  defs: McpToolDef[],
  hasGetSchemaTool: boolean,
): string {
  const inventory = buildMcpToolNameInventory(defs);
  const howToUse = hasGetSchemaTool
    ? `1. If you recognize the tool you need, call \`get_mcp_tool_schema\` with its name(s) to get its description and full TypeScript declaration.
2. If you are not sure which tool you need, call \`search_mcp_tools\` with keywords (optionally a \`server\`) to find candidates and get their declarations.
3. Call the declared host functions inside this script, exactly as declared.`
    : `1. Call \`search_mcp_tools\` with keywords (optionally a \`server\`) to get the TypeScript declarations of the tools you need.
2. Call the declared host functions inside this script, exactly as declared.`;
  const inventoryHeading = hasGetSchemaTool
    ? "Available MCP tools (call get_mcp_tool_schema for a tool's signature):"
    : "Available MCP tools (search for one with search_mcp_tools to get its signature):";
  return `

MCP tools can also be invoked from inside the script. The tools available on each connected server are listed below by name only. To use one:
${howToUse}
- Each MCP tool invocation may trigger a user consent prompt. A denied call throws.
- MCP host functions are only available on the 'main' execution thread. They are NOT available on the 'worker' thread — if you need both heavy compute and MCP calls, split into two scripts (worker for the compute, then main for the MCP follow-up).

${inventoryHeading}
\`\`\`
${inventory}
\`\`\``;
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
  options?: {
    useSearch?: boolean;
    hasGetSchemaTool?: boolean;
    includeWriteFile?: boolean;
  },
): Promise<string> {
  const defs = precomputedDefs ?? (await collectMcpToolDefs());
  const builtInHostFunctionsPreamble = buildBuiltInHostFunctionsPreamble({
    includeWriteFile: options?.includeWriteFile ?? isWriteFileHostEnabled(),
  });
  if (defs.length === 0) {
    return builtInHostFunctionsPreamble;
  }
  // Search mode: list tool names and point the model at the discovery tools
  // instead of inlining every tool's declarations. `hasGetSchemaTool` defaults
  // to true since get_mcp_tool_schema is normally registered alongside search;
  // the handler passes false when tool permissions have filtered it out.
  if (options?.useSearch) {
    return (
      builtInHostFunctionsPreamble +
      buildMcpSearchAddendum(defs, options.hasGetSchemaTool ?? true)
    );
  }
  return (
    builtInHostFunctionsPreamble + buildMcpAddendum(buildMcpTypeDefsBlock(defs))
  );
}

export const executeSandboxScriptTool: ToolDefinition<ExecuteSandboxScriptArgs> =
  {
    name: "execute_sandbox_script",
    description:
      "Run a MustardScript program in a sandbox. Supports file inspection, file writes, and MCP tool calls.",
    inputSchema: executeSandboxScriptSchema,
    defaultConsent: "always",
    modifiesState: (ctx) => ctx.sandboxWriteFileHostEnabled === true,

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

function parseWriteFileHostArgs(
  pathOrArgs: unknown,
  content?: unknown,
  description?: unknown,
) {
  const args =
    pathOrArgs !== null &&
    typeof pathOrArgs === "object" &&
    !Array.isArray(pathOrArgs)
      ? pathOrArgs
      : { path: pathOrArgs, content, description };
  let parsed: z.infer<typeof writeFileTool.inputSchema>;
  try {
    parsed = writeFileTool.inputSchema.parse(args);
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new DyadError(
        `Invalid write_file arguments: ${error.issues.map((issue) => issue.message).join("; ")}`,
        DyadErrorKind.Validation,
      );
    }
    throw error;
  }
  if (parsed.path.startsWith("attachments:")) {
    throw new DyadError(
      "write_file cannot write attachment paths from sandbox scripts.",
      DyadErrorKind.Validation,
    );
  }
  assertAllowedGuestPath(parsed.path);
  return parsed;
}

function trackSandboxWriteFile(ctx: AgentContext, path: string): void {
  if (!ctx.fileEditTracker[path]) {
    ctx.fileEditTracker[path] = {
      write_file: 0,
      search_replace: 0,
    };
  }
  ctx.fileEditTracker[path].write_file++;
}

function buildWriteFileCapability(ctx: AgentContext) {
  return async (
    pathOrArgs: unknown,
    content?: unknown,
    description?: unknown,
  ) => {
    const args = parseWriteFileHostArgs(pathOrArgs, content, description);
    if (readSettings().agentToolConsents?.write_file === "never") {
      throw new DyadError(
        "write_file is disabled in agent tool permissions.",
        DyadErrorKind.Precondition,
      );
    }
    const allowed = await ctx.requireConsent({
      toolName: writeFileTool.name,
      toolDescription: writeFileTool.description,
      inputPreview: writeFileTool.getConsentPreview?.(args) ?? null,
      metadata: writeFileTool.getConsentMetadata?.(args) ?? null,
    });
    if (!allowed) {
      throw new DyadError(
        `User denied permission for ${writeFileTool.name}`,
        DyadErrorKind.UserCancelled,
      );
    }

    trackSandboxWriteFile(ctx, args.path);
    const result = await writeFileTool.execute(args, ctx);
    const xml = writeFileTool.buildXml?.(args, true);
    if (xml) {
      ctx.onXmlComplete(xml);
    }
    return result;
  };
}

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
  const writeFileCaps: Record<string, (...args: unknown[]) => unknown> =
    params.ctx.sandboxWriteFileHostEnabled === true && isWriteFileHostEnabled()
      ? { write_file: buildWriteFileCapability(params.ctx) }
      : {};
  const mcpCaps = buildMcpCapabilityMap({
    event: params.ctx.event,
    ctx: params.ctx,
    defs,
  });
  const capabilities = {
    ...(fileCaps as unknown as Record<string, (...args: unknown[]) => unknown>),
    ...mcpCaps,
    ...writeFileCaps,
  };

  return executeSandboxScriptInProcess({
    appPath: params.ctx.appPath,
    script: params.args.script,
    capabilities,
  });
}
