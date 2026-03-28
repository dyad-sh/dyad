/**
 * get_app_logs tool — Check the app's build status and capture recent output.
 * Runs `npx tsc --noEmit` or similar to get a fresh diagnostic report.
 */

import { exec } from "node:child_process";
import { z } from "zod";
import log from "electron-log";
import { ToolDefinition, AgentContext, escapeXmlContent } from "./types";
import {
  parseErrors,
  formatErrorsForAgent,
} from "@/lib/error_parser";
import type { ErrorSource } from "@/types/error_types";

const logger = log.scope("get_app_logs");

const getAppLogsSchema = z.object({
  check_type: z
    .enum(["build", "typecheck", "lint"])
    .optional()
    .describe(
      'Type of check to run: "build" (npm run build), "typecheck" (tsc --noEmit), "lint" (eslint). Defaults to "typecheck".',
    ),
});

export const getAppLogsTool: ToolDefinition<
  z.infer<typeof getAppLogsSchema>
> = {
  name: "get_app_logs",
  description: `Check the app for build errors, type errors, or lint issues. Returns diagnostic output.
Use this after making changes to verify the app compiles correctly.
- "typecheck" (default): Runs TypeScript type checking (fast, no output files)
- "build": Runs the full build (npm run build)
- "lint": Runs ESLint if configured`,
  inputSchema: getAppLogsSchema,
  defaultConsent: "always",

  getConsentPreview: (args) =>
    `Check: ${args.check_type ?? "typecheck"}`,

  buildXml: (args, isComplete) => {
    const type = args.check_type ?? "typecheck";
    let xml = `<joy-output type="diagnostic" check="${type}">`;
    if (isComplete) {
      xml += "</joy-output>";
    }
    return xml;
  },

  execute: async (args, ctx: AgentContext) => {
    const checkType = args.check_type ?? "typecheck";

    let command: string;
    switch (checkType) {
      case "typecheck":
        command = "npx tsc --noEmit 2>&1";
        break;
      case "build":
        command = "npm run build 2>&1";
        break;
      case "lint":
        command = "npx eslint src/ --format compact 2>&1";
        break;
      default:
        command = "npx tsc --noEmit 2>&1";
    }

    logger.info(`Running ${checkType} check in ${ctx.appPath}: ${command}`);

    return new Promise<string>((resolve) => {
      exec(
        command,
        {
          cwd: ctx.appPath,
          timeout: 60_000,
          maxBuffer: 1024 * 1024,
          env: {
            ...process.env,
            CI: "true",
            FORCE_COLOR: "0",
          },
        },
        (error, stdout, stderr) => {
          let output = "";

          if (stdout?.trim()) {
            output += stdout.trim();
          }
          if (stderr?.trim()) {
            output += (output ? "\n" : "") + stderr.trim();
          }

          if (!output) {
            output = error
              ? `Check failed with exit code ${error.code ?? "unknown"}`
              : "No errors found — all checks passed.";
          } else if (!error) {
            output = "All checks passed.\n" + output;
          }

          // Truncate if too long
          const MAX = 8_000;
          if (output.length > MAX) {
            output =
              output.slice(0, MAX / 2) +
              "\n\n... [output truncated] ...\n\n" +
              output.slice(-MAX / 2);
          }

          // Parse errors into structured format for the agent
          if (error) {
            const sourceMap: Record<string, ErrorSource> = {
              typecheck: "typescript",
              build: "build",
              lint: "lint",
            };
            const structured = parseErrors(
              output,
              sourceMap[checkType] ?? "typescript",
            );
            if (structured.length > 0) {
              output +=
                "\n\n--- Structured Analysis ---\n" +
                formatErrorsForAgent(structured);
            }
          }

          resolve(output);
        },
      );
    });
  },
};
