/**
 * Narrow execution-backend boundary for chat turns.
 *
 * `chat_stream_handlers.ts` owns turn admission, persistence, and the
 * renderer stream protocol. Everything below that line — actually running the
 * model/agent for one turn — sits behind this interface:
 *
 * - The existing Dyad agent (`handleLocalAgentStream`) is the `dyad` backend.
 *   It predates this boundary and still talks to the stream handler directly;
 *   `DYAD_AGENT_BACKEND_DESCRIPTOR` documents it as such rather than wrapping
 *   its many mode-specific entry points.
 * - Claude Code (`src/claude_code/turn_runner.ts`) implements
 *   `ChatBackendTurnRunner` and never enters Dyad's model/tool loop.
 *
 * The interface intentionally covers only: starting/resuming a turn,
 * streaming text and tool events, approval requests/responses, cancellation,
 * completion, errors, and usage reporting.
 */
import type { ChatExecutionBackend } from "@/shared/chat_backend";
import type { ClaudeCodeModelUsage } from "@/shared/claude_code_pricing";

export type ChatBackendTurnMode = "agent" | "ask" | "plan";

export interface ChatBackendAttachment {
  /** Absolute path on disk (already persisted under `.dyad/media`). */
  filePath: string;
  originalName: string;
  mimeType: string;
  attachmentType: "upload-to-codebase" | "chat-context";
}

export interface ChatBackendTurnInput {
  chatId: number;
  appId: number;
  /** Absolute app directory the backend is authorized to operate in. */
  appPath: string;
  mode: ChatBackendTurnMode;
  /** Model name as selected in the picker (may be an alias). */
  requestedModel: string;
  effortLevel?: string | null;
  /** Fully assembled user prompt (mentions, selected components, etc.). */
  prompt: string;
  attachments: ChatBackendAttachment[];
  /** App instructions (AI_RULES.md) to append to the backend's system prompt. */
  appInstructions: string | null;
  /**
   * Existing backend session to resume, or null to start a new one. A backend
   * must never resume anything other than this explicit id.
   */
  sessionId: string | null;
  /** Session id to use when `sessionId` is null (pre-minted so it can be persisted first). */
  newSessionId: string;
  /** Stable, idempotent usage-event id for this turn. */
  usageEventId: string;
}

export interface ChatBackendApprovalRequest {
  /** Backend tool name (e.g. `Write`, `mcp__dyad__add_dependency`). */
  toolName: string;
  /** Dyad tool name the request maps to for consent settings (e.g. `write_file`). */
  consentToolName: string;
  description: string | null;
  inputPreview: string | null;
  input: unknown;
}

export type ChatBackendApprovalResponse =
  | { behavior: "allow" }
  | { behavior: "deny"; message: string };

export type ChatBackendEvent =
  | { type: "session-started"; sessionId: string; resumed: boolean }
  | { type: "model-resolved"; model: string }
  | { type: "text-delta"; text: string }
  | {
      type: "tool-start";
      toolCallId: string;
      toolName: string;
      input: unknown;
    }
  | {
      type: "tool-result";
      toolCallId: string;
      toolName: string;
      output: string;
      isError: boolean;
    }
  | { type: "tool-denied"; toolName: string; reason: string }
  | { type: "warning"; message: string }
  | { type: "rate-limit"; message: string };

export interface ChatBackendTurnContext {
  signal: AbortSignal;
  emit: (event: ChatBackendEvent) => void;
  requestApproval: (
    request: ChatBackendApprovalRequest,
  ) => Promise<ChatBackendApprovalResponse>;
}

export interface ChatBackendTurnUsage {
  /** One entry per model the backend used during the turn. */
  perModel: ClaudeCodeModelUsage[];
  /** Cost the backend itself estimated, when it reports one (informational). */
  backendReportedCostUsd: number | null;
}

export type ChatBackendTurnFailureKind =
  | "not-installed"
  | "unsupported-version"
  | "unauthenticated"
  | "api-key-billing"
  | "usage-limit"
  | "session-not-found"
  | "spawn-failed"
  | "crashed"
  | "protocol"
  | "cancelled"
  | "unknown";

export interface ChatBackendTurnResult {
  status: "completed" | "cancelled" | "error";
  sessionId: string | null;
  resolvedModel: string | null;
  /** Usage reported by the backend, even for failed or cancelled turns. */
  usage: ChatBackendTurnUsage | null;
  /** Final assistant text (already streamed through `text-delta`). */
  finalText: string;
  error?: { kind: ChatBackendTurnFailureKind; message: string };
}

export interface ChatBackendTurnRunner {
  readonly backend: ChatExecutionBackend;
  runTurn(
    input: ChatBackendTurnInput,
    context: ChatBackendTurnContext,
  ): Promise<ChatBackendTurnResult>;
}

/**
 * Descriptor for the legacy Dyad agent backend. Its turn execution lives in
 * `handleLocalAgentStream` and is dispatched directly by the stream handler;
 * listing it here keeps the backend registry exhaustive.
 */
export const DYAD_AGENT_BACKEND_DESCRIPTOR = {
  backend: "dyad" as const,
  entryPoint: "src/pro/main/ipc/handlers/local_agent/local_agent_handler.ts",
} as const;
