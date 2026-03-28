/**
 * verify_app tool — Run TypeScript diagnostics and return a structured verification report.
 *
 * This is a read-only check tool. It does NOT attempt to fix errors — it reports
 * them in a structured format so the agent can decide the next step.
 * For automated fix loops, the post-agent verification system uses
 * `runVerificationLoop` directly.
 */

import { z } from "zod";
import log from "electron-log";
import { generateProblemReport } from "@/ipc/processors/tsc";
import {
  problemReportToStructuredErrors,
  formatErrorsForAgent,
} from "@/lib/error_parser";
import type { ToolDefinition, AgentContext } from "./types";

const logger = log.scope("verify_app");

const verifyAppSchema = z.object({
  check: z
    .enum(["typecheck", "all"])
    .optional()
    .describe(
      '"typecheck" (default) runs TypeScript diagnostics. "all" also summarises error categories and fix strategies.',
    ),
});

export const verifyAppTool: ToolDefinition<z.infer<typeof verifyAppSchema>> = {
  name: "verify_app",
  description: `Run a full TypeScript diagnostic check on the app and return a structured error report.
Use this after making a batch of changes to see ALL errors at once, categorised by type with suggested fix strategies.
Faster and more informative than \`get_app_logs\` for catching type errors.`,
  inputSchema: verifyAppSchema,
  defaultConsent: "always",

  getConsentPreview: () => "Run TypeScript verification",

  buildXml: (_args, isComplete) => {
    let xml = '<joy-output type="verification">';
    if (isComplete) xml += "</joy-output>";
    return xml;
  },

  execute: async (args, ctx: AgentContext) => {
    const checkLevel = args.check ?? "typecheck";

    logger.info(`Running verify_app (${checkLevel}) in ${ctx.appPath}`);

    let report;
    try {
      report = await generateProblemReport({
        fullResponse: "",
        appPath: ctx.appPath,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return `Verification failed: ${msg}`;
    }

    if (report.problems.length === 0) {
      return "Verification passed — no TypeScript errors found.";
    }

    const structured = problemReportToStructuredErrors(report);

    if (checkLevel === "all") {
      return formatErrorsForAgent(structured);
    }

    // Concise "typecheck" mode — just list errors
    let out = `Found ${structured.length} TypeScript error${structured.length === 1 ? "" : "s"}:\n\n`;

    for (const err of structured) {
      const loc = err.file
        ? `${err.file}${err.line ? `:${err.line}` : ""}`
        : "(unknown)";
      out += `- ${loc}: ${err.message}`;
      if (err.code) out += ` [TS${err.code}]`;
      out += "\n";
    }

    return out;
  },
};
