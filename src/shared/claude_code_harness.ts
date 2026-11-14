import type { RuntimeMode2, UserSettings } from "@/lib/schemas";

/**
 * Which tool surface a Claude Code turn uses.
 *
 * - `dyad-tools`: Claude Code runs with no native tools; every operation goes
 *   through Dyad's MCP bridge (the original experiment).
 * - `native`: Claude Code uses its own built-in tools (Bash, Edit, …) and the
 *   user's Claude Code setup; Dyad only offers what Claude Code lacks.
 */
export type ClaudeCodeHarness = "dyad-tools" | "native";

/** Why a Claude Code turn that would have used native tools did not. */
export type NativeHarnessFallbackReason = "runtime";

export interface ClaudeCodeHarnessDecision {
  harness: ClaudeCodeHarness;
  /** Set when the user opted in but this turn still uses Dyad's tools for a
   * reason worth telling them about. Mode-based fallbacks (Ask/Plan/Build)
   * are expected and stay silent. */
  fallbackReason?: NativeHarnessFallbackReason;
}

/** Native tools are an Agent-mode, host-runtime opt-in on top of the Claude
 * Code subscription experiment. Every caller (prompt construction, tool
 * binding, CLI arguments) must use this one decision for a turn. */
export function resolveClaudeCodeHarness({
  settings,
  provider,
  agentMode,
  runtimeMode,
}: {
  settings: Pick<
    UserSettings,
    "enableClaudeCodeSubscription" | "enableClaudeCodeNativeTools"
  >;
  /** Provider of the model selected for this turn. */
  provider: string;
  /** True only for writable Agent turns (not Ask, Plan or Build). */
  agentMode: boolean;
  /** Effective runtime of the app this turn edits. */
  runtimeMode: RuntimeMode2;
}): ClaudeCodeHarnessDecision {
  if (
    provider !== "claude-code" ||
    !settings.enableClaudeCodeSubscription ||
    !settings.enableClaudeCodeNativeTools ||
    !agentMode
  )
    return { harness: "dyad-tools" };
  if (runtimeMode !== "host")
    return { harness: "dyad-tools", fallbackReason: "runtime" };
  return { harness: "native" };
}

/** Whether a chat has opted into session continuity across harness and mode
 * changes. Once a session has been used with continuity, later turns keep
 * resuming it even after the user turns native tools off. */
export function wantsClaudeSessionContinuity(
  settings: Pick<
    UserSettings,
    "enableClaudeCodeSubscription" | "enableClaudeCodeNativeTools"
  >,
): boolean {
  return (
    !!settings.enableClaudeCodeSubscription &&
    !!settings.enableClaudeCodeNativeTools
  );
}
