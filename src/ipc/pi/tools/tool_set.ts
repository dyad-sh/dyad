/**
 * pi tool-set builder.
 *
 * Selects which Dyad tools belong in a given chat mode and adapts each one to
 * a pi `AgentTool` via ./adapter.
 */

import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { TSchema } from "typebox";

import type { ChatMode } from "@/lib/schemas";
import {
  TOOL_DEFINITIONS,
  shouldIncludeTool,
  type BuildAgentToolSetOptions,
} from "./dyad/tool_registry";
import type { AgentContext } from "./dyad/types";
import { adaptTool, type AdaptToolOptions } from "./adapter";

/**
 * Map a Dyad chat mode onto the tool-selection options `shouldIncludeTool`
 * understands.
 *
 * - `agent` (formerly `local-agent`): full tool set.
 * - `ask`: read-only tools (no state mutation).
 * - `plan`: read-only + planning-specific tools.
 *
 */
export function chatModeToToolOptions(
  chatMode: ChatMode,
): BuildAgentToolSetOptions {
  switch (chatMode) {
    case "ask":
      return { readOnly: true };
    case "plan":
      return { planModeOnly: true };
    case "local-agent":
    default:
      return {};
  }
}

export interface BuildPiToolSetParams extends AdaptToolOptions {
  chatMode: ChatMode;
  /**
   * The context used only for `shouldIncludeTool` gating decisions (which read
   * turn-scoped flags like `testingEnabled`). This is distinct from the
   * per-invocation context the adapter builds via `contextFactory`.
   */
  gatingContext: AgentContext;
  /** Additional tool-selection overrides merged onto the chat-mode defaults. */
  optionOverrides?: BuildAgentToolSetOptions;
}

/**
 * Build the adapted pi tool set for a chat mode.
 */
export function buildPiToolSet(
  params: BuildPiToolSetParams,
): AgentTool<TSchema, any>[] {
  const options: BuildAgentToolSetOptions = {
    ...chatModeToToolOptions(params.chatMode),
    ...params.optionOverrides,
  };

  const tools: AgentTool<TSchema, any>[] = [];
  for (const toolDef of TOOL_DEFINITIONS) {
    if (!shouldIncludeTool(toolDef, params.gatingContext, options)) {
      continue;
    }
    tools.push(
      adaptTool(toolDef, {
        contextFactory: params.contextFactory,
        onToolErrorXml: params.onToolErrorXml,
      }),
    );
  }
  return tools;
}
