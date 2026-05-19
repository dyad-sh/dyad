import { z } from "zod";
import {
  executeSandboxScriptInProcess,
  isSandboxSupportedPlatform,
} from "@/ipc/utils/sandbox/execution";
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

const STATIC_PREAMBLE = `Run a small program written in a strict, sandboxed subset of JavaScript (MustardScript) to inspect files and/or invoke MCP tools.

Use this when you need to slice, search, count, aggregate, summarize file contents, OR call one or more MCP tools (optionally chaining their results) before answering. Return only the concise value you need.

Supported language surface:
- let/const, functions, closures, arrow functions, async/await, promises, arrays, plain objects, Map, Set, if/switch, loops, break/continue, try/catch/finally, throw, template literals, destructuring, optional chaining, nullish coalescing, JSON, Math, and conservative Array/String/Object/Date/Intl/RegExp helpers.
- Top-level await is not supported because scripts are not modules. When calling async host functions, wrap the script body in an async function and call it, e.g. \`async function main() { const text = await read_file("attachments:data.csv"); return text.length; } main();\`.
- The script has no ambient authority. It can only act through the host functions below.

Recommendations:
- Avoid defining nested helper functions in the main function.

Unsupported / unavailable:
- No import/export, require, CommonJS, npm packages, Node APIs, browser/DOM APIs, process, module, exports, global, environment variables, subprocesses, network/fetch, timers, eval, Function constructor, with, classes, generators, custom iterator authoring, Symbols, WeakMap, WeakSet, typed arrays, ArrayBuffer, shared memory, atomics, Proxy, accessors, full prototype/property-descriptor semantics, or arbitrary filesystem access.
- String.prototype.localeCompare is not supported; compare with <, >, or === instead.
- Unsupported syntax or unsupported built-in behavior fails closed with an error. Rewrite using simpler JavaScript when that happens.

Avoid returning shared references:

\`\`\`
const row = { key: "x", total: 1 };
return { a: row, b: row }; // rejected
\`\`\`

Return cloned/plain rows instead:

\`\`\`
return {
  a: { key: row.key, total: row.total },
  b: { key: row.key, total: row.total }
};
\`\`\`

Each MCP tool invocation may trigger a user consent prompt. A denied call throws.

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

Paths are app-relative (including \`.dyad/media/<stored-name>\`), or attachment paths like attachments:filename.ext. Prefer range reads, filtering, aggregation, and small summaries over returning entire files.

MCP host functions (TypeScript declarations):
`;

/**
 * Build the full tool description including the dynamic MCP type defs block.
 * Called per-turn so the description reflects the currently enabled MCP
 * servers.
 */
export async function buildExecuteSandboxScriptDescription(): Promise<string> {
  const defs = await collectMcpToolDefs();
  const typeDefsBlock = buildMcpTypeDefsBlock(defs);
  return `${STATIC_PREAMBLE}\n\`\`\`ts\n${typeDefsBlock}\n\`\`\``;
}

export const executeSandboxScriptTool: ToolDefinition<ExecuteSandboxScriptArgs> =
  {
    name: "execute_sandbox_script",
    description:
      "Run a MustardScript program in a sandbox. Supports file inspection and MCP tool calls. (Dynamic description with MCP type defs is built per-turn.)",
    inputSchema: executeSandboxScriptSchema,
    defaultConsent: "always",

    isEnabled: () =>
      isSandboxSupportedPlatform() &&
      isSandboxScriptExecutionEnabled(readSettings()),

    getConsentPreview: (args) =>
      args.description?.trim() || "Run a sandboxed script",

    execute: async (args: ExecuteSandboxScriptArgs, ctx: AgentContext) => {
      try {
        const defs = await collectMcpToolDefs();
        const fileCaps = buildSandboxCapabilitiesWithObserver(
          ctx.appPath,
          ({ path }) => {
            if (isAttachmentHostCallPath(path)) {
              ctx.onAttachmentAccess?.();
            }
          },
        );
        const mcpCaps = buildMcpCapabilityMap({ event: ctx.event, ctx, defs });
        const capabilities = {
          ...(fileCaps as unknown as Record<
            string,
            (...args: unknown[]) => unknown
          >),
          ...mcpCaps,
        };

        const result = await executeSandboxScriptInProcess({
          appPath: ctx.appPath,
          script: args.script,
          capabilities,
        });

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
        });

        if (result.truncated) {
          sendTelemetryEvent("sandbox.script.truncated", {
            chatId: ctx.chatId,
            appId: ctx.appId,
            fullOutputPath: result.fullOutputPath,
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
