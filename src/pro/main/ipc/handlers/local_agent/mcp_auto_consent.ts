import type { UserSettings } from "@/lib/schemas";
import { buildMcpConsentSystemPrompt } from "@/prompts/mcp_consent_policy";
import type { McpAutoApproveResult } from "@/ipc/utils/mcp_consent";
import { reviewToolAction } from "./tool_safety_reviewer";
import {
  formatRecentTurns,
  getRecentTurnsForConsent,
  type RecentTurn,
} from "./mcp_consent_context";

export interface McpConsentDecision {
  decision: "allow" | "ask";
  reason: string;
}

export interface ClassifyMcpToolConsentInput {
  serverName: string;
  toolName: string;
  toolDescription?: string | null;
  inputSchema?: unknown;
  args: unknown;
  recentTurns: RecentTurn[];
  settings: UserSettings;
  signal?: AbortSignal;
}

function buildUserPayload(input: ClassifyMcpToolConsentInput): string {
  const schema = input.inputSchema
    ? JSON.stringify(input.inputSchema)
    : "(none)";
  const lines = [
    `MCP server: ${input.serverName}`,
    `Tool: ${input.toolName}`,
    `Description: ${input.toolDescription ?? "(none)"}`,
    `Input schema: ${schema}`,
    `Arguments: ${JSON.stringify(input.args)}`,
  ];
  if (input.recentTurns.length > 0) {
    lines.push(
      "",
      "Recent conversation (oldest first):",
      formatRecentTurns(input.recentTurns),
    );
  }
  return lines.join("\n");
}

export async function classifyMcpToolConsent(
  input: ClassifyMcpToolConsentInput,
): Promise<McpConsentDecision> {
  return reviewToolAction({
    settings: input.settings,
    system: buildMcpConsentSystemPrompt(),
    fallback: "ask",
    signal: input.signal,
    prepare: async () => ({ payload: buildUserPayload(input) }),
  });
}

// Builds the auto-approve callback for requireMcpToolConsent, or undefined when
// the feature is off or the turn is running in Dyad Free mode. Shared by both
// agent MCP paths (sandbox host functions and directly-registered tools) so
// auto-approval behaves the same regardless of how the tool is plumbed.
export function buildMcpAutoApprove(params: {
  signal?: AbortSignal;
  settings: UserSettings;
  isDyadPro: boolean;
  freeModelMode?: boolean;
  chatId: number;
  serverName: string;
  toolName: string;
  toolDescription?: string | null;
  inputSchema?: unknown;
  args: unknown;
}): (() => Promise<McpAutoApproveResult>) | undefined {
  if (
    !params.settings.autoApproveSafeMcpTools ||
    !params.isDyadPro ||
    params.freeModelMode
  ) {
    return undefined;
  }
  return async () => {
    // On error, fall through to the consent prompt. Without this, the error
    // propagates and the tool call errors out instead of asking.
    try {
      const recentTurns = await getRecentTurnsForConsent(params.chatId);
      const decision = await classifyMcpToolConsent({
        serverName: params.serverName,
        toolName: params.toolName,
        toolDescription: params.toolDescription,
        inputSchema: params.inputSchema,
        args: params.args,
        recentTurns,
        settings: params.settings,
        signal: params.signal,
      });
      return {
        approved: decision.decision === "allow",
        reason: decision.reason,
      };
    } catch {
      return { approved: false };
    }
  };
}
