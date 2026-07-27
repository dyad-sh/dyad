/**
 * runTurn — the deep module that hides pi from the chat stream handler.
 *
 * Per the architectural review, `chat_stream_handlers.ts` must keep owning the
 * stream lifecycle (InvocationRef, admission barriers, cancellation, workspace
 * recovery, durable turn acceptance). It must NOT depend on pi's `AgentEvent`
 * or `Agent`. This module is the seam: the handler hands over an accepted turn
 * plus an abort signal and an event sink, and gets back a `TurnOutcome`. All pi
 * details (agent construction, tool set, event translation) live here.
 *
 *   runTurn(input) -> Promise<TurnOutcome>
 *
 * The event sink receives fully-formed `ChatResponseChunk`s (content fields
 * filled by the translator); the handler stamps chatId/invocationRef and sends
 * them via safeSend. runTurn never touches Electron IO.
 */

import type {
  Agent,
  AgentMessage,
  AgentTool,
} from "@earendil-works/pi-agent-core";
import type { TSchema } from "typebox";
import {
  isRetryableAssistantError,
  type AssistantMessage,
  type ImageContent,
  type ToolResultMessage,
} from "@earendil-works/pi-ai";
import type { ChatResponseChunk } from "@/ipc/types";
import { DyadErrorKind } from "@/errors/dyad_error";
import type { ChatMode, LargeLanguageModel, UserSettings } from "@/lib/schemas";
import { createDyadAgent } from "../agent_factory";
import { classifyPiProviderError } from "../provider_error";
import type { AdaptedToolDetails } from "../tools/adapter";
import { ChatEventTranslator } from "./event_translator";

/** Sink the handler provides to receive translated chunks as the turn streams. */
export type ChunkSink = (chunk: ChatResponseChunk) => void | Promise<void>;

export interface RunTurnInput {
  chatId: number;
  /** DB id of the assistant message being streamed into. */
  streamingMessageId: number;
  model: LargeLanguageModel;
  settings: UserSettings;
  chatMode: ChatMode;
  systemPrompt: string;
  /** Prompt text for this turn (already resolved: mentions, media, etc). */
  prompt: string;
  /** Inline images attached to the prompt. */
  images?: ImageContent[];
  /** The tool set for this turn (built by the caller via buildPiToolSet). */
  tools: AgentTool<TSchema, any>[];
  /** Prior transcript to seed the agent with (rebuilt from the DB). */
  messages?: Parameters<typeof createDyadAgent>[0]["messages"];
  /** Session id forwarded to providers for cache-aware backends. */
  sessionId?: string;
  /** Correlation id forwarded to provider request headers. */
  dyadRequestId?: string;
  /** Stream-scoped abort signal owned by the handler. */
  abortSignal?: AbortSignal;
  /** Receives translated chunks in order as the turn streams. */
  onChunk: ChunkSink;
  /** Returns an internal prompt for one follow-up pass, or undefined to stop. */
  getFollowUpPrompt?: () => string | undefined;
  /** Returns and removes renderer XML captured for a failed tool call. */
  takeToolErrorXml?: (toolCallId: string) => string | undefined;
  /** Durably persist the messages appended so far at safe event boundaries. */
  onCheckpoint?: (
    turnMessages: readonly AgentMessage[],
  ) => void | Promise<void>;
}

export interface TurnOutcome {
  /** Full final assistant content (text + folded tool XML) for DB persistence. */
  content: string;
  /** Full final pi transcript, including the prior history. */
  transcript: AgentMessage[];
  /** Messages appended by this turn (user prompt + assistant/tool messages). */
  turnMessages: AgentMessage[];
  /** True if the turn was aborted before completing. */
  aborted: boolean;
  /** Error message if the turn failed, else undefined. */
  errorMessage?: string;
  /** Classified provider failure, when the turn ended with an error. */
  errorKind?: DyadErrorKind;
}

const EMPTY_USAGE = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

const MAX_TRANSIENT_STREAM_RETRIES = 3;
const STREAM_RETRY_BASE_DELAY_MS = 400;

function getRetryableFailure(agent: Agent): AssistantMessage | undefined {
  const message = agent.state.messages.at(-1);
  if (message?.role === "assistant" && isRetryableAssistantError(message)) {
    return message;
  }
  return undefined;
}

function waitForRetry(delayMs: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const finish = () => {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", finish);
      resolve();
    };
    const timeout = setTimeout(finish, delayMs);
    signal?.addEventListener("abort", finish, { once: true });
  });
}

function toPiUserMessage(value: unknown): AgentMessage | null {
  if (!Array.isArray(value)) return null;

  const content: Array<
    | { type: "text"; text: string }
    | { type: "image"; data: string; mimeType: string }
  > = [];
  for (const part of value) {
    if (!part || typeof part !== "object") continue;
    const record = part as Record<string, unknown>;
    if (record.type === "text" && typeof record.text === "string") {
      content.push({ type: "text", text: record.text });
      continue;
    }
    if (record.type === "image-url" && typeof record.url === "string") {
      const match = /^data:([^;,]+);base64,(.*)$/s.exec(record.url);
      if (match) {
        content.push({ type: "image", mimeType: match[1], data: match[2] });
      }
    }
  }

  return content.length > 0
    ? { role: "user", content, timestamp: Date.now() }
    : null;
}

function createPreAbortedOutcome(
  agent: Agent,
  input: RunTurnInput,
  initialMessageCount: number,
): TurnOutcome {
  const timestamp = Date.now();
  const userMessage: AgentMessage = {
    role: "user",
    content: [{ type: "text", text: input.prompt }, ...(input.images ?? [])],
    timestamp,
  };
  const assistantMessage: AgentMessage = {
    role: "assistant",
    content: [{ type: "text", text: "" }],
    api: agent.state.model.api,
    provider: agent.state.model.provider,
    model: agent.state.model.id,
    usage: EMPTY_USAGE,
    stopReason: "aborted",
    errorMessage: "Cancelled by user",
    timestamp,
  };
  const transcript = [...agent.state.messages, userMessage, assistantMessage];

  return {
    content: "",
    transcript,
    turnMessages: transcript.slice(initialMessageCount),
    aborted: true,
    errorMessage: "Cancelled by user",
  };
}

/**
 * Run one agent turn on pi and stream translated chunks to `onChunk`.
 *
 * Resolves when the agent run settles (agent_end + awaited listeners). Never
 * throws for model/tool failures — those are captured in `TurnOutcome`.
 */
export async function runTurn(input: RunTurnInput): Promise<TurnOutcome> {
  const initialMessageCount = input.messages?.length ?? 0;
  const translator = new ChatEventTranslator({
    chatId: input.chatId,
    streamingMessageId: input.streamingMessageId,
  });

  const agent: Agent = await createDyadAgent({
    model: input.model,
    settings: input.settings,
    chatMode: input.chatMode,
    systemPrompt: input.systemPrompt,
    tools: input.tools,
    messages: input.messages,
    sessionId: input.sessionId,
    dyadRequestId: input.dyadRequestId,
  });

  // v1: tools execute sequentially so the single-slot preview overlay in the
  // translator matches at most one running tool (see review point 3).
  agent.toolExecution = "sequential";
  agent.afterToolCall = async ({ toolCall, isError }) => {
    if (!isError) return undefined;

    const xml = input.takeToolErrorXml?.(toolCall.id);
    if (!xml) return undefined;

    return {
      details: {
        toolName: toolCall.name,
        xml,
        appendedUserMessages: [],
      } satisfies AdaptedToolDetails,
    };
  };

  let errorMessage: string | undefined;
  let followUpMessage: AgentMessage | undefined;
  const checkpoint = async (extraMessage?: AgentMessage) => {
    if (!input.onCheckpoint) return;
    const transcript = agent.state.messages.filter(
      (message) => message !== followUpMessage,
    );
    if (extraMessage) transcript.push(extraMessage);
    await input.onCheckpoint(transcript.slice(initialMessageCount));
  };

  agent.subscribe(async (event, signal) => {
    if (event.type === "agent_end") {
      // Surface the final error message, if any, from agent state.
      const err = agent.state.errorMessage;
      if (err) errorMessage = err;
    }
    if (event.type === "tool_execution_end" && !signal.aborted) {
      const details = (event.result as { details?: AdaptedToolDetails })
        .details;
      for (const appended of details?.appendedUserMessages ?? []) {
        const message = toPiUserMessage(appended);
        if (message) agent.steer(message);
      }
      const result = event.result as {
        content?: ToolResultMessage["content"];
        details?: unknown;
        usage?: ToolResultMessage["usage"];
        addedToolNames?: string[];
      };
      await checkpoint({
        role: "toolResult",
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        content: result.content ?? [],
        details: result.details,
        usage: result.usage,
        ...(result.addedToolNames?.length
          ? { addedToolNames: result.addedToolNames }
          : {}),
        isError: event.isError,
        timestamp: Date.now(),
      });
    }
    if (
      event.type === "turn_end" &&
      !followUpMessage &&
      !signal.aborted &&
      event.message.role === "assistant" &&
      event.message.stopReason !== "error" &&
      event.message.stopReason !== "aborted" &&
      !event.message.content.some((block) => block.type === "toolCall")
    ) {
      const prompt = input.getFollowUpPrompt?.();
      if (prompt) {
        followUpMessage = {
          role: "user",
          content: [{ type: "text", text: prompt }],
          timestamp: Date.now(),
        };
        agent.followUp(followUpMessage);
      }
    }
    for (const chunk of translator.feed(event)) {
      await input.onChunk(chunk);
    }
    if (event.type === "message_end") {
      await checkpoint();
    }
  });

  const abortSignal = input.abortSignal;
  if (abortSignal?.aborted) {
    return createPreAbortedOutcome(agent, input, initialMessageCount);
  }

  let abortRequested = false;
  const onAbort = () => {
    abortRequested = true;
    agent.abort();
  };
  abortSignal?.addEventListener("abort", onAbort, { once: true });

  try {
    const promptPromise = agent.prompt(input.prompt, input.images);
    // agent.prompt() installs its active run synchronously. Re-check after it
    // starts so an abort requested at the setup/prompt boundary is not lost.
    if (abortRequested || abortSignal?.aborted) {
      agent.abort();
    }
    await promptPromise;
    await agent.waitForIdle();

    for (
      let retryCount = 0;
      retryCount < MAX_TRANSIENT_STREAM_RETRIES;
      retryCount++
    ) {
      if (!getRetryableFailure(agent) || abortSignal?.aborted) break;

      await waitForRetry(
        STREAM_RETRY_BASE_DELAY_MS * 2 ** retryCount,
        abortSignal,
      );
      if (abortSignal?.aborted) break;

      for (const chunk of translator.discardActiveAssistant()) {
        await input.onChunk(chunk);
      }

      // The failed assistant message may contain partial text or an incomplete
      // tool call. Remove only that message; completed tool results before it
      // remain in context, so continuing cannot execute them twice.
      agent.state.messages = agent.state.messages.slice(0, -1);
      await agent.continue();
      await agent.waitForIdle();
    }
  } finally {
    abortSignal?.removeEventListener("abort", onAbort);
  }

  const failed = Boolean(abortSignal?.aborted) || !!agent.state.errorMessage;
  const transcript = agent.state.messages.filter(
    (message) => message !== followUpMessage,
  );
  const failedAssistant = [...transcript]
    .reverse()
    .find(
      (message): message is AssistantMessage =>
        message.role === "assistant" && message.stopReason === "error",
    );

  return {
    content: translator.finalContent(),
    transcript,
    turnMessages: transcript.slice(initialMessageCount),
    aborted: Boolean(abortSignal?.aborted),
    errorMessage: failed ? errorMessage : undefined,
    errorKind: failedAssistant
      ? classifyPiProviderError(failedAssistant)
      : failed
        ? DyadErrorKind.External
        : undefined,
  };
}
