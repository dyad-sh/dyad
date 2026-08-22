/**
 * Pure lifecycle state for a durable sub-agent thread.
 *
 * Persistence metadata stays in the controller; transition decisions depend
 * only on the current status and whether remediation has already been claimed.
 */
export interface SubagentLifecycleState {
  readonly status: SubagentStatus;
  readonly remediationSource:
    | "fix_button"
    | "auto_fix"
    | "queued_message_override"
    | null;
}

export const SUBAGENT_NONTERMINAL_STATUSES = [
  "queued",
  "running",
  "stopping",
  "waiting_for_writer",
  "auto_fix_countdown",
  "fixing_findings",
] as const;

export const SUBAGENT_TERMINAL_STATUSES = [
  "completed",
  "partial",
  "review_outdated",
  "cancelled",
  "entitlement_revoked",
  "interrupted_by_restart",
  "failed",
] as const;

export type SubagentStatus =
  | (typeof SUBAGENT_NONTERMINAL_STATUSES)[number]
  | (typeof SUBAGENT_TERMINAL_STATUSES)[number];

export type SubagentTerminalStatus =
  (typeof SUBAGENT_TERMINAL_STATUSES)[number];

export function isNonterminalSubagentStatus(status: SubagentStatus): boolean {
  return (SUBAGENT_NONTERMINAL_STATUSES as readonly SubagentStatus[]).includes(
    status,
  );
}

export function subagentLifecycleState(input: {
  status: SubagentStatus;
  remediationSource?: SubagentLifecycleState["remediationSource"];
}): SubagentLifecycleState {
  return {
    status: input.status,
    remediationSource: input.remediationSource ?? null,
  };
}
