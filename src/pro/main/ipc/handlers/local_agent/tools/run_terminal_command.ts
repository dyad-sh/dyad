import { spawn } from "node:child_process";
import { z } from "zod";

import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import type { AgentContext, ToolDefinition } from "./types";

const MAX_OUTPUT_CHARS = 30_000;

const runTerminalCommandSchema = z.object({
  command: z
    .string()
    .min(1)
    .max(8_000)
    .describe("Shell command to run in the active workspace"),
  timeoutSeconds: z
    .number()
    .int()
    .min(1)
    .max(120)
    .optional()
    .describe("Maximum execution time; defaults to 60 seconds"),
});

function clippedOutput(value: string): string {
  if (value.length <= MAX_OUTPUT_CHARS) return value;
  return `${value.slice(0, MAX_OUTPUT_CHARS)}\n\n[Output truncated]`;
}

export const runTerminalCommandTool: ToolDefinition<
  z.infer<typeof runTerminalCommandSchema>
> = {
  name: "run_terminal_command",
  description:
    "Run a terminal command with the active workspace as its locked working directory",
  inputSchema: runTerminalCommandSchema,
  defaultConsent: "ask",
  modifiesState: true,
  getConsentPreview: ({ command }) => command,
  execute: async ({ command, timeoutSeconds = 60 }, ctx: AgentContext) => {
    if (command.includes("\u0000")) {
      throw new DyadError(
        "Terminal commands cannot contain null bytes.",
        DyadErrorKind.Validation,
      );
    }

    return new Promise<string>((resolve, reject) => {
      const child = spawn(command, {
        cwd: ctx.appPath,
        env: process.env,
        shell: true,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
      let stdout = "";
      let stderr = "";
      let timedOut = false;
      const timeout = setTimeout(() => {
        timedOut = true;
        child.kill("SIGTERM");
      }, timeoutSeconds * 1_000);

      child.stdout.on("data", (chunk) => {
        stdout += String(chunk);
      });
      child.stderr.on("data", (chunk) => {
        stderr += String(chunk);
      });
      child.on("error", (error) => {
        clearTimeout(timeout);
        reject(
          new DyadError(
            `Could not start terminal command: ${error.message}`,
            DyadErrorKind.External,
          ),
        );
      });
      child.on("close", (exitCode) => {
        clearTimeout(timeout);
        if (timedOut) {
          reject(
            new DyadError(
              `Terminal command timed out after ${timeoutSeconds} seconds.`,
              DyadErrorKind.External,
            ),
          );
          return;
        }
        const output = clippedOutput(
          [
            stdout.trim() && `stdout:\n${stdout.trim()}`,
            stderr.trim() && `stderr:\n${stderr.trim()}`,
          ]
            .filter(Boolean)
            .join("\n\n"),
        );
        if (exitCode !== 0) {
          reject(
            new DyadError(
              `Terminal command exited with code ${exitCode}.${output ? `\n\n${output}` : ""}`,
              DyadErrorKind.External,
            ),
          );
          return;
        }
        resolve(output || "Command completed successfully with no output.");
      });
    });
  },
};
