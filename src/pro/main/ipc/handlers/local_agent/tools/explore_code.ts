import { z } from "zod";

import { readSettings } from "@/main/settings";
import {
  formatCodeExplorerDisabledReason,
  getCodeExplorerAvailability,
} from "@/ipc/processors/code_explorer";
import {
  AgentContext,
  ToolDefinition,
  escapeXmlAttr,
  escapeXmlContent,
} from "./types";
import type { CodeExplorerResult } from "../../../../../../../shared/code_explorer_types";
import {
  exploreCodeSchema,
  normalizeExploreCodeArgsForApp,
} from "./explore_code_raw";
import { runExploreCodeSubagent } from "./explore_code_subagent";
import { resolveTargetAppPath } from "./resolve_app_context";

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

function buildExploreCodeAttributes(
  args: Partial<z.infer<typeof exploreCodeSchema>>,
  result?: CodeExplorerResult,
): string {
  const attrs: string[] = [];
  if (args.query) attrs.push(`query="${escapeXmlAttr(args.query)}"`);
  if (args.intent) attrs.push(`intent="${escapeXmlAttr(args.intent)}"`);
  if (args.app_name) attrs.push(`app_name="${escapeXmlAttr(args.app_name)}"`);
  if (args.tsconfig_path) {
    attrs.push(`tsconfig_path="${escapeXmlAttr(args.tsconfig_path)}"`);
  }
  if (result) {
    attrs.push(`files="${result.files.length}"`);
    attrs.push(`symbols="${result.totalSymbols}"`);
    attrs.push(`index_ms="${result.indexMs}"`);
    attrs.push(`search_ms="${result.searchMs}"`);
    if (result.truncated) attrs.push(`truncated="true"`);
  }
  return attrs.join(" ");
}

export const exploreCodeTool: ToolDefinition<
  z.infer<typeof exploreCodeSchema>
> = {
  name: "explore_code",
  description: `Ask a code reconnaissance sub-agent to find and map relevant code when the relevant files are not reasonably clear from the available context.

If the relevant files or source ranges are already known or reasonably clear from the conversation, prior investigation, selected components, tool results, or other available context, use targeted grep/list_files/read_file calls instead. This tool returns a compact report: a Flow of file/line ranges with quoted evidence, optional Read targets and Search targets, a Confidence, and an Action.

Set the intent argument to what you will do with the result: explain to understand behavior; locate to find the best files or symbols; edit or debug when preparing to change, diagnose, or verify code.

Use the report's Action as the recommended next step:

| Action | Do next | Do NOT |
|--------|---------|--------|
| answer_from_report | Answer or plan directly from the report when it contains enough detail. | Repeat the report's discovery work without a new question or unresolved detail. |
| read_targets | Use the listed targets as jump points; read their tight ranges when exact implementation details, editing, debugging, or verification require it. | Start a broader investigation before using the report's focused targets. |
| targeted_gap_search | Run the rendered Search targets, then continue with targeted exploration as needed to resolve the identified gap. | Restart the same broad discovery or ignore the report's suggested scope without reason. |
| skip_explore_result | Proceed without the report; nothing relevant was found. | Treat it as a map. |

Treat the report as a starting map: build on its findings rather than repeating the same discovery work. Targeted grep/list_files/read_file calls are appropriate whenever needed to resolve gaps, inspect implementation details, follow newly discovered paths, debug behavior, or prepare an edit. If confidence is low, inspect the listed read/search targets before relying on the report. If an Action calls for Search targets but none are rendered, use the observed Flow and name the remaining gap.

The sub-agent can search and read files broadly. Its compiler-backed symbol and flow results cover files included in the app's TypeScript config; JavaScript and JSX need TypeScript config support such as allowJs.`,
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
    return `<dyad-explore-code ${buildExploreCodeAttributes(args)}>Exploring...`;
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

    const streamExploreProgress = (progressText: string) => {
      ctx.onXmlStream(
        `<dyad-explore-code ${buildExploreCodeAttributes(effectiveArgs)}>\n${escapeXmlContent(progressText)}`,
      );
    };

    streamExploreProgress("Exploring...");

    const resultText = await runExploreCodeSubagent({
      args: effectiveArgs,
      ctx,
      onProgress: streamExploreProgress,
    });
    ctx.onXmlComplete(
      `<dyad-explore-code ${buildExploreCodeAttributes(effectiveArgs)}>\n${escapeXmlContent(resultText)}\n</dyad-explore-code>`,
    );
    return resultText;
  },
};
