/**
 * think_and_plan tool — Structured planning space for the agent.
 * The agent uses this to outline its approach before making changes.
 * This tool doesn't modify any files — it's purely for planning.
 */

import { z } from "zod";
import { ToolDefinition, escapeXmlAttr, escapeXmlContent } from "./types";

const thinkAndPlanSchema = z.object({
  analysis: z
    .string()
    .describe(
      "Your analysis of the current state: what exists, what needs to change, and any potential issues",
    ),
  plan: z
    .string()
    .describe(
      "Step-by-step plan of the files you will create/modify and the changes you will make",
    ),
  dependencies: z
    .string()
    .optional()
    .describe("Any new packages, APIs, or integrations needed"),
});

export const thinkAndPlanTool: ToolDefinition<
  z.infer<typeof thinkAndPlanSchema>
> = {
  name: "think_and_plan",
  description: `Use this tool to plan your approach BEFORE making code changes. 
This is especially important for:
- Multi-file changes
- New features that require architectural decisions
- Complex refactoring
- Debugging tricky issues

The plan will be shown to the user so they can see your reasoning. This tool does NOT modify any files.`,
  inputSchema: thinkAndPlanSchema,
  defaultConsent: "always",

  getConsentPreview: (args) =>
    `Planning: ${args.plan?.slice(0, 80) ?? "..."}`,

  buildXml: (args, isComplete) => {
    let xml = "<joy-think>\n";
    if (args.analysis) {
      xml += `**Analysis:** ${args.analysis}\n\n`;
    }
    if (args.plan) {
      xml += `**Plan:** ${args.plan}\n\n`;
    }
    if (args.dependencies) {
      xml += `**Dependencies:** ${args.dependencies}\n`;
    }
    if (isComplete) {
      xml += "</joy-think>";
    }
    return xml;
  },

  execute: async (args) => {
    // This tool is purely for planning — return the plan as confirmation
    let result = `Plan confirmed.\n\nAnalysis: ${args.analysis}\n\nPlan: ${args.plan}`;
    if (args.dependencies) {
      result += `\n\nDependencies: ${args.dependencies}`;
    }
    return result;
  },
};
