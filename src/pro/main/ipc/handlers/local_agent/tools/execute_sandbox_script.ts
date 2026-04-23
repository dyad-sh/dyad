import { z } from "zod";
import {
  runSandboxScript,
  isSandboxSupportedPlatform,
} from "@/ipc/utils/sandbox/runner";
import { sendTelemetryEvent } from "@/ipc/utils/telemetry";
import { readSettings } from "@/main/settings";
import {
  AgentContext,
  escapeXmlAttr,
  escapeXmlContent,
  ToolDefinition,
} from "./types";

const executeSandboxScriptSchema = z.object({
  script: z
    .string()
    .max(32 * 1024)
    .describe("MustardScript source code to execute."),
  description: z
    .string()
    .max(160)
    .optional()
    .describe("One-line human-readable summary of what the script reads."),
});

type ExecuteSandboxScriptArgs = z.infer<typeof executeSandboxScriptSchema>;

function isAttachmentHostCallPath(path: string | undefined): boolean {
  return (
    path === "attachments" ||
    path === "attachments:" ||
    path?.startsWith("attachments:") === true
  );
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

export const executeSandboxScriptTool: ToolDefinition<ExecuteSandboxScriptArgs> =
  {
    name: "execute_sandbox_script",
    description: `Run a small read-only MustardScript program to inspect attached files or project files without loading all contents into context.

Available host functions:
- read_file(path, { start?, length?, encoding? }) for app-relative paths or attachments:<filename>
- list_files(dir) where dir can be "." or "attachments:"
- file_stats(path)

Return a concise value. Prefer range reads, filtering, aggregation, and small summaries over returning entire files.`,
    inputSchema: executeSandboxScriptSchema,
    defaultConsent: "ask",

    isEnabled: () => isSandboxSupportedPlatform(),

    getConsentPreview: (args) =>
      args.description?.trim() || "Run a read-only script",

    execute: async (args: ExecuteSandboxScriptArgs, ctx: AgentContext) => {
      sendTelemetryEvent("sandbox.script.run", {
        chatId: ctx.chatId,
        appId: ctx.appId,
      });

      try {
        const result = await runSandboxScript({
          appPath: ctx.appPath,
          script: args.script,
          timeoutMs: readSettings().sandboxScriptTimeoutMs,
          onHostCall: ({ path }) => {
            if (isAttachmentHostCallPath(path)) {
              ctx.onAttachmentAccess?.();
            }
          },
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
        throw error;
      }
    },
  };
