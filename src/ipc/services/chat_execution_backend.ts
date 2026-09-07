import type { IpcMainInvokeEvent } from "electron";
import type { ChatStreamParams } from "@/ipc/types/chat";
import { handleLocalAgentStream } from "@/pro/main/ipc/handlers/local_agent/local_agent_handler";
import { handleClaudeCodeTurn } from "./claude_code/turn";

/** Backend lifecycle boundary. Both adapters emit the existing correlated chat
 * stream, persist their own response/usage, and park approvals through the
 * shared user-input service. Cancellation is main-owned and drained before
 * runTurn settles. Session resumption is adapter-specific, never global. */
export interface ChatExecutionBackend<Options> {
  readonly id: "dyad" | "claude-code";
  runTurn(
    event: IpcMainInvokeEvent,
    request: ChatStreamParams,
    cancellation: AbortController,
    options: Options,
  ): Promise<boolean>;
}

export const dyadChatBackend: ChatExecutionBackend<
  Parameters<typeof handleLocalAgentStream>[3]
> = {
  id: "dyad",
  // Resolve the live binding at invocation time: the legacy handler imports
  // stream utilities through a cycle and can still be initializing here.
  runTurn: (...args) => handleLocalAgentStream(...args),
};
export const claudeChatBackend: ChatExecutionBackend<
  Parameters<typeof handleClaudeCodeTurn>[3]
> = {
  id: "claude-code",
  runTurn: (...args) => handleClaudeCodeTurn(...args),
};
