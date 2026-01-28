/**
 * Session Data Collector
 *
 * Collects timing, AI calls, tool calls, and error data during local agent
 * stream processing for later upload and analysis.
 */

import type {
  AiCallInfo,
  ToolCallInfo,
  ErrorInfo,
  StreamTiming,
  TokenUsage,
  AiCallFinishReason,
  ToolCallStatus,
  AssistantMessageInfo,
} from "@/ipc/types/session_upload";

// =============================================================================
// Types
// =============================================================================

export interface AiCallData {
  index: number;
  model: string;
  startedAt: Date;
  completedAt: Date | null;
  firstTokenAt: Date | null;
  finishReason: AiCallFinishReason;
  tokenUsage: TokenUsage | null;
  toolCallIds: string[];
  textDeltaCount: number;
  reasoningDeltaCount: number;
  error: ErrorInfo | null;
  providerRequestId: string | null;
}

export interface ToolCallData {
  id: string;
  toolName: string;
  status: ToolCallStatus;
  input: unknown;
  output: unknown;
  startedAt: Date;
  completedAt: Date | null;
  error: ErrorInfo | null;
  consentRequired: boolean;
  consentDecision: "accept-once" | "accept-always" | "decline" | null;
  aiCallIndex: number;
  isMcpTool: boolean;
  mcpServerName: string | null;
}

// =============================================================================
// Session Data Collector
// =============================================================================

/**
 * Collects all session data during local agent stream processing.
 * Create one instance per assistant message generation.
 *
 * @example
 * ```typescript
 * const collector = new SessionDataCollector(messageId, model);
 *
 * // Start tracking
 * collector.startMessage();
 *
 * // Track AI calls
 * collector.startAiCall();
 * collector.recordFirstToken();
 * collector.recordTextDelta();
 * collector.endAiCall("tool-calls", tokenUsage);
 *
 * // Track tool calls
 * collector.startToolCall("call_123", "write_file", { file_path: "..." });
 * collector.endToolCall("call_123", "success", "File written");
 *
 * // Finish and get data
 * collector.endMessage(false);
 * const data = collector.getAssistantMessageData(content);
 * ```
 */
export class SessionDataCollector {
  private messageId: number;
  private model: string;
  private requestId: string | null = null;

  // Message-level timing
  private messageStartedAt: Date | null = null;
  private messageCompletedAt: Date | null = null;
  private messageFirstTokenAt: Date | null = null;

  // AI calls
  private aiCalls: AiCallData[] = [];
  private currentAiCall: AiCallData | null = null;

  // Tool calls
  private toolCalls: Map<string, ToolCallData> = new Map();

  // Errors
  private errors: ErrorInfo[] = [];

  // Cancellation
  private wasCancelled = false;
  private maxStepsReached = false;

  constructor(messageId: number, model: string, requestId?: string | null) {
    this.messageId = messageId;
    this.model = model;
    this.requestId = requestId ?? null;
  }

  // ===========================================================================
  // Message-level tracking
  // ===========================================================================

  /**
   * Mark the start of message generation.
   * Call this when beginning to process the assistant message.
   */
  startMessage(): void {
    this.messageStartedAt = new Date();
  }

  /**
   * Mark the end of message generation.
   * @param wasCancelled Whether the message was cancelled by the user
   * @param maxStepsReached Whether the max steps limit was reached
   */
  endMessage(wasCancelled = false, maxStepsReached = false): void {
    this.messageCompletedAt = new Date();
    this.wasCancelled = wasCancelled;
    this.maxStepsReached = maxStepsReached;

    // End any in-progress AI call
    if (this.currentAiCall && !this.currentAiCall.completedAt) {
      this.currentAiCall.completedAt = this.messageCompletedAt;
      this.currentAiCall.finishReason = wasCancelled ? "cancelled" : "unknown";
    }
  }

  // ===========================================================================
  // AI Call tracking
  // ===========================================================================

  /**
   * Start a new AI call (step).
   * Call this at the beginning of each streamText call or step.
   * @param model Optional model override for this call
   */
  startAiCall(model?: string): void {
    // End previous AI call if not ended
    if (this.currentAiCall && !this.currentAiCall.completedAt) {
      this.currentAiCall.completedAt = new Date();
    }

    this.currentAiCall = {
      index: this.aiCalls.length,
      model: model ?? this.model,
      startedAt: new Date(),
      completedAt: null,
      firstTokenAt: null,
      finishReason: "unknown",
      tokenUsage: null,
      toolCallIds: [],
      textDeltaCount: 0,
      reasoningDeltaCount: 0,
      error: null,
      providerRequestId: null,
    };
    this.aiCalls.push(this.currentAiCall);
  }

  /**
   * Record when the first token is received.
   * Call this on the first text-delta or reasoning-delta.
   */
  recordFirstToken(): void {
    const now = new Date();
    if (this.currentAiCall && !this.currentAiCall.firstTokenAt) {
      this.currentAiCall.firstTokenAt = now;
    }
    if (!this.messageFirstTokenAt) {
      this.messageFirstTokenAt = now;
    }
  }

  /**
   * Record a text delta.
   * Call this on each text-delta stream part.
   */
  recordTextDelta(): void {
    if (this.currentAiCall) {
      this.currentAiCall.textDeltaCount++;
    }
  }

  /**
   * Record a reasoning delta.
   * Call this on each reasoning-delta stream part.
   */
  recordReasoningDelta(): void {
    if (this.currentAiCall) {
      this.currentAiCall.reasoningDeltaCount++;
    }
  }

  /**
   * End the current AI call.
   * @param finishReason Why the AI call finished
   * @param tokenUsage Token usage for this call
   * @param providerRequestId Optional provider request ID
   */
  endAiCall(
    finishReason: AiCallFinishReason,
    tokenUsage?: TokenUsage | null,
    providerRequestId?: string | null,
  ): void {
    if (this.currentAiCall) {
      this.currentAiCall.completedAt = new Date();
      this.currentAiCall.finishReason = finishReason;
      this.currentAiCall.tokenUsage = tokenUsage ?? null;
      this.currentAiCall.providerRequestId = providerRequestId ?? null;
    }
  }

  /**
   * Record an error for the current AI call.
   */
  recordAiCallError(error: Error | string, code = "AI_CALL_ERROR"): void {
    const errorInfo = this.createErrorInfo(error, code);
    if (this.currentAiCall) {
      this.currentAiCall.error = errorInfo;
      this.currentAiCall.finishReason = "error";
    }
    this.errors.push(errorInfo);
  }

  // ===========================================================================
  // Tool Call tracking
  // ===========================================================================

  /**
   * Start tracking a tool call.
   * Call this when a tool call begins (tool-input-start or tool-call).
   */
  startToolCall(
    id: string,
    toolName: string,
    input: unknown,
    options?: {
      isMcpTool?: boolean;
      mcpServerName?: string | null;
    },
  ): void {
    const toolCall: ToolCallData = {
      id,
      toolName,
      status: "running",
      input,
      output: null,
      startedAt: new Date(),
      completedAt: null,
      error: null,
      consentRequired: false,
      consentDecision: null,
      aiCallIndex: this.currentAiCall?.index ?? 0,
      isMcpTool: options?.isMcpTool ?? false,
      mcpServerName: options?.mcpServerName ?? null,
    };
    this.toolCalls.set(id, toolCall);

    // Track tool call ID in current AI call
    if (this.currentAiCall) {
      this.currentAiCall.toolCallIds.push(id);
    }
  }

  /**
   * Record consent information for a tool call.
   */
  recordToolConsent(
    id: string,
    required: boolean,
    decision?: "accept-once" | "accept-always" | "decline" | null,
  ): void {
    const toolCall = this.toolCalls.get(id);
    if (toolCall) {
      toolCall.consentRequired = required;
      toolCall.consentDecision = decision ?? null;
      if (decision === "decline") {
        toolCall.status = "denied";
        toolCall.completedAt = new Date();
      }
    }
  }

  /**
   * End a tool call with its result.
   */
  endToolCall(
    id: string,
    status: "success" | "failed" | "cancelled" | "denied",
    output?: unknown,
    error?: Error | string,
  ): void {
    const toolCall = this.toolCalls.get(id);
    if (toolCall) {
      toolCall.completedAt = new Date();
      toolCall.status = status;
      toolCall.output = output ?? null;
      if (error) {
        toolCall.error = this.createErrorInfo(error, "TOOL_EXECUTION_FAILED", {
          toolName: toolCall.toolName,
          toolCallId: id,
        });
        this.errors.push(toolCall.error);
      }
    }
  }

  /**
   * Update tool call input (useful when input is streamed).
   */
  updateToolCallInput(id: string, input: unknown): void {
    const toolCall = this.toolCalls.get(id);
    if (toolCall) {
      toolCall.input = input;
    }
  }

  // ===========================================================================
  // Error tracking
  // ===========================================================================

  /**
   * Record a general error (not tied to a specific AI call or tool call).
   */
  recordError(
    error: Error | string,
    code = "UNKNOWN_ERROR",
    context?: Record<string, unknown>,
  ): void {
    this.errors.push(this.createErrorInfo(error, code, context));
  }

  private createErrorInfo(
    error: Error | string,
    code: string,
    context?: Record<string, unknown>,
  ): ErrorInfo {
    const message = error instanceof Error ? error.message : error;
    const stack = error instanceof Error ? error.stack : null;
    return {
      code,
      message,
      stack: stack ?? null,
      timestamp: new Date().toISOString(),
      context,
    };
  }

  // ===========================================================================
  // Data export
  // ===========================================================================

  /**
   * Get the collected data as an AssistantMessageInfo object.
   * Call this after endMessage() to get the final data.
   */
  getAssistantMessageData(
    content: string,
    createdAt: Date,
    additionalData?: {
      approvalState?: "approved" | "rejected" | null;
      sourceCommitHash?: string | null;
      commitHash?: string | null;
    },
  ): AssistantMessageInfo {
    const timing = this.getMessageTiming();
    const tokenUsage = this.getAggregatedTokenUsage();

    return {
      id: this.messageId,
      role: "assistant",
      content,
      createdAt: createdAt.toISOString(),
      model: this.model,
      requestId: this.requestId,
      approvalState: additionalData?.approvalState ?? null,
      sourceCommitHash: additionalData?.sourceCommitHash ?? null,
      commitHash: additionalData?.commitHash ?? null,
      timing,
      tokenUsage,
      aiCalls: this.getAiCallsInfo(),
      toolCalls: this.getToolCallsInfo(),
      errors: this.errors.length > 0 ? this.errors : undefined,
      wasCancelled: this.wasCancelled || undefined,
      maxStepsReached: this.maxStepsReached || undefined,
    };
  }

  private getMessageTiming(): StreamTiming {
    const startedAt = this.messageStartedAt ?? new Date();
    const completedAt = this.messageCompletedAt;
    const firstTokenAt = this.messageFirstTokenAt;

    return {
      startedAt: startedAt.toISOString(),
      completedAt: completedAt?.toISOString() ?? null,
      durationMs: completedAt
        ? completedAt.getTime() - startedAt.getTime()
        : null,
      firstTokenAt: firstTokenAt?.toISOString() ?? null,
      timeToFirstTokenMs: firstTokenAt
        ? firstTokenAt.getTime() - startedAt.getTime()
        : null,
    };
  }

  private getAggregatedTokenUsage(): TokenUsage | null {
    let totalInput = 0;
    let totalOutput = 0;
    let totalCached = 0;
    let hasUsage = false;

    for (const aiCall of this.aiCalls) {
      if (aiCall.tokenUsage) {
        hasUsage = true;
        totalInput += aiCall.tokenUsage.inputTokens;
        totalOutput += aiCall.tokenUsage.outputTokens;
        totalCached += aiCall.tokenUsage.cachedInputTokens ?? 0;
      }
    }

    if (!hasUsage) return null;

    return {
      inputTokens: totalInput,
      outputTokens: totalOutput,
      totalTokens: totalInput + totalOutput,
      cachedInputTokens: totalCached > 0 ? totalCached : null,
      cacheHitRatio: totalInput > 0 ? totalCached / totalInput : null,
    };
  }

  private getAiCallsInfo(): AiCallInfo[] {
    return this.aiCalls.map((call) => {
      const durationMs = call.completedAt
        ? call.completedAt.getTime() - call.startedAt.getTime()
        : null;
      const timeToFirstTokenMs = call.firstTokenAt
        ? call.firstTokenAt.getTime() - call.startedAt.getTime()
        : null;

      return {
        index: call.index,
        model: call.model,
        finishReason: call.finishReason,
        timing: {
          startedAt: call.startedAt.toISOString(),
          completedAt: call.completedAt?.toISOString() ?? null,
          durationMs,
          firstTokenAt: call.firstTokenAt?.toISOString() ?? null,
          timeToFirstTokenMs,
        },
        tokenUsage: call.tokenUsage,
        toolCallIds: call.toolCallIds,
        textDeltaCount: call.textDeltaCount,
        reasoningDeltaCount: call.reasoningDeltaCount,
        error: call.error ?? undefined,
        providerRequestId: call.providerRequestId ?? undefined,
      };
    });
  }

  private getToolCallsInfo(): ToolCallInfo[] {
    return Array.from(this.toolCalls.values()).map((call) => {
      const durationMs = call.completedAt
        ? call.completedAt.getTime() - call.startedAt.getTime()
        : null;

      return {
        id: call.id,
        toolName: call.toolName,
        status: call.status,
        input: call.input,
        output: call.output,
        timing: {
          startedAt: call.startedAt.toISOString(),
          completedAt: call.completedAt?.toISOString() ?? null,
          durationMs,
        },
        error: call.error ?? undefined,
        consentRequired: call.consentRequired,
        consentDecision: call.consentDecision ?? undefined,
        aiCallIndex: call.aiCallIndex,
        isMcpTool: call.isMcpTool || undefined,
        mcpServerName: call.mcpServerName ?? undefined,
      };
    });
  }

  // ===========================================================================
  // Utility getters
  // ===========================================================================

  /** Get the current AI call index (step number) */
  getCurrentAiCallIndex(): number {
    return this.currentAiCall?.index ?? 0;
  }

  /** Check if there's an active AI call */
  hasActiveAiCall(): boolean {
    return this.currentAiCall !== null && !this.currentAiCall.completedAt;
  }

  /** Get total tool calls count */
  getToolCallCount(): number {
    return this.toolCalls.size;
  }

  /** Get successful tool calls count */
  getSuccessfulToolCallCount(): number {
    return Array.from(this.toolCalls.values()).filter(
      (t) => t.status === "success",
    ).length;
  }

  /** Get failed tool calls count */
  getFailedToolCallCount(): number {
    return Array.from(this.toolCalls.values()).filter(
      (t) => t.status === "failed" || t.status === "denied",
    ).length;
  }

  /** Get total errors count */
  getErrorCount(): number {
    return this.errors.length;
  }
}
