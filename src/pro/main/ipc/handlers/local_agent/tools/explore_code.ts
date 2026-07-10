import { z } from "zod";

import { readSettings } from "@/main/settings";
import {
  formatCodeExplorerDisabledReason,
  getCodeExplorerAvailability,
} from "@/ipc/processors/code_explorer";
import { AgentContext, ToolDefinition, escapeXmlAttr } from "./types";
import {
  exploreCodeSchema,
  normalizeExploreCodeArgsForApp,
} from "./explore_code_raw";
import { runExploreCodeSubagent } from "./explore_code_subagent";
import { formatExploreStepSummary } from "./explore_code_subagent_progress";
import { createSubagentUiEmitter } from "./subagent_ui";
import { resolveTargetAppPath } from "./resolve_app_context";
import type { ExplorerOutputData } from "@/shared/subagent_types";

export function getExploreCodeAvailability(ctx: AgentContext): {
  enabled: boolean;
  reason: string | null;
  tsconfigPath: string | null;
} {
  return getExploreCodeAvailabilityForAppPath(ctx, ctx.appPath);
}

function getExploreCodeAvailabilityForAppPath(
  ctx: AgentContext,
  appPath: string,
): {
  enabled: boolean;
  reason: string | null;
  tsconfigPath: string | null;
} {
  if (!ctx.isDyadPro) {
    return {
      enabled: false,
      reason: "dyad_pro_required",
      tsconfigPath: null,
    };
  }

  const settings = readSettings();
  if (!settings.enableCodeExplorer) {
    return {
      enabled: false,
      reason: "code_explorer_setting_disabled",
      tsconfigPath: null,
    };
  }

  const availability = getCodeExplorerAvailability(appPath);
  return {
    enabled: availability.ready,
    reason: availability.ready
      ? null
      : (availability.reason ?? formatCodeExplorerDisabledReason(availability)),
    tsconfigPath: availability.tsconfigPath,
  };
}

function formatExplorerOutputSummary(output: ExplorerOutputData): string {
  const paths = new Set<string>([
    ...output.flow.map((entry) => entry.path),
    ...output.readTargets.map((target) => target.path),
  ]);
  const fileCount = paths.size;
  const fileText = `${fileCount} file${fileCount === 1 ? "" : "s"}`;
  if (output.action === "skip_explore_result") {
    return "nothing relevant found";
  }
  return `${output.confidence} confidence · ${fileText}`;
}

export const exploreCodeTool: ToolDefinition<
  z.infer<typeof exploreCodeSchema>
> = {
  name: "explore_code",
  description: `Ask a code reconnaissance sub-agent to explore code included in a configured TypeScript project.

Use this when you need to understand how a TypeScript, TSX, JavaScript, or JSX feature, symbol, type, component, service, or flow is implemented across files. It returns a compact report: a Flow of file/line ranges with quoted evidence, optional Read targets and Search targets, a Confidence, and an Action. Treat a high- or medium-confidence report as the codebase map and follow its Action rather than rediscovering the code.

Set the intent argument to what you will do with the result: explain for "trace how", data-flow, request-flow, or "how is this computed/surfaced" questions; locate for finding the best files/symbols; edit or debug when you will read exact ranges before changing code or verifying behavior.

Follow the report's Action:

| Action | Do next | Do NOT |
|--------|---------|--------|
| answer_from_report | Answer or plan directly from the report. | Re-read discovery files, grep, or call explore_code again. |
| read_targets | explain/locate: answer from the report, citing the listed targets as jump points. edit/debug: read only the listed tight ranges before changing or verifying code. | Read targets just to confirm the map for explain/locate (unless confidence is low or the user asked for edits/debugging/exact verification). |
| targeted_gap_search | Run only the rendered Search targets with their exact terms/scopes, then answer from the report plus those results and name any remaining gap. | Invent broader searches, open arbitrary hits, or call explore_code again. |
| skip_explore_result | Proceed without the report; nothing relevant was found. | Treat it as a map. |

If confidence is low, inspect the listed read/search targets before relying on the report. If an Action calls for Search targets but none are rendered, answer from the observed Flow and name the remaining gap. Do not call explore_code repeatedly for the same investigation after a high- or medium-confidence report.

Only use this for files included in the app's TypeScript config. JavaScript and JSX require TypeScript config support such as allowJs. If the project does not have TypeScript installed and configured, use grep/list_files/read_file instead.`,
  inputSchema: exploreCodeSchema,
  defaultConsent: "always",
  usesEngineEndpoint: true,

  isEnabled: (ctx) => getExploreCodeAvailability(ctx).enabled,

  getConsentPreview: (args) => {
    let preview = `Explore code for "${args.query}"`;
    if (args.app_name) preview += ` (app: ${args.app_name})`;
    return preview;
  },

  buildXml: (args, isComplete) => {
    if (!args.query) return undefined;
    if (isComplete) return undefined;
    // Placeholder while the tool-call args stream; execute() replaces this
    // with the run's streamed <dyad-subagent> events (see subagent_ui.ts).
    const attrs = [
      `type="code-explorer"`,
      `title="${escapeXmlAttr(args.query)}"`,
    ];
    if (args.app_name) {
      attrs.push(`app-name="${escapeXmlAttr(args.app_name)}"`);
    }
    return `<dyad-subagent ${attrs.join(" ")}>\n`;
  },

  execute: async (args, ctx: AgentContext) => {
    const targetAppPath = resolveTargetAppPath(ctx, args.app_name);
    const availability = getExploreCodeAvailabilityForAppPath(
      ctx,
      targetAppPath,
    );
    const effectiveArgs = normalizeExploreCodeArgsForApp({
      appPath: targetAppPath,
      args,
      fallbackTsconfigPath: availability.tsconfigPath,
    });

    const emitter = createSubagentUiEmitter({
      type: "code-explorer",
      title: effectiveArgs.query,
      appName: effectiveArgs.app_name,
      ctx,
    });

    let structuredOutput: ExplorerOutputData | null = null;
    let resultText: string;
    try {
      resultText = await runExploreCodeSubagent({
        args: effectiveArgs,
        ctx,
        onObservation: (observation, index) => {
          emitter.step({
            index: index + 1,
            toolName: observation.toolName,
            summary: formatExploreStepSummary(observation),
            detail: observation.result,
            status: "done",
          });
        },
        onOutput: (output) => {
          structuredOutput = output;
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      emitter.error(`Exploration failed: ${message}`);
      throw error;
    }

    emitter.complete({
      summary: structuredOutput
        ? formatExplorerOutputSummary(structuredOutput)
        : "report ready",
      data: structuredOutput,
    });
    return resultText;
  },
};
