/**
 * pi AgentEvent -> Dyad chat-stream chunk translator.
 *
 * The chat stream handler subscribes to a pi `Agent` and must turn
 * pi's `AgentEvent` stream into the renderer chunk protocol
 * (`ChatResponseChunk` in src/ipc/types/chat.ts). This module is the pure,
 * side-effect-free core of that translation so it can be unit-tested without
 * an Electron sender or a live model:
 *
 *   feed(agentEvent) -> ChatResponseChunk[]   (zero or more chunks to send)
 *
 * The handler owns IO (safeSend, DB writes); this owns the mapping.
 *
 * Mapping:
 *   - assistant text and thinking blocks accumulate into the streaming
 *     assistant message. Thinking is wrapped in the existing `<think>` UI tag.
 *     We emit a tail-only `streamingPatch` (via the existing
 *     computeStreamingPatch) so long responses don't re-serialize unchanged
 *     bytes.
 *   - tool execution (tool_execution_start/update/end) surfaces the adapted
 *     tool's captured `<dyad-*>` XML (see AdaptedToolDetails.xml) as a
 *     `streamingPreview` overlay while running, and folds the final XML into
 *     the assistant content on completion.
 */

import type { AgentEvent } from "@earendil-works/pi-agent-core";
import type { ChatResponseChunk } from "@/ipc/types";
import { computeStreamingPatch } from "@/ipc/utils/stream_text_utils";
import type { AdaptedToolDetails } from "../tools/adapter";

export interface EventTranslatorOptions {
  chatId: number;
  /** DB id of the assistant message being streamed into. */
  streamingMessageId: number;
}

/**
 * Extract renderer-visible content from a pi assistant message. The currently
 * streaming thinking block stays open until pi emits `thinking_end`, allowing
 * the renderer to show its in-progress state.
 */
function accumulatedContent(
  message: {
    content?: Array<{ type: string; text?: string; thinking?: string }>;
  },
  activeThinkingContentIndex: number | undefined,
): string {
  if (!message.content) return "";
  let out = "";
  for (const [index, block] of message.content.entries()) {
    if (block.type === "text" && typeof block.text === "string") {
      out += block.text;
    } else if (
      block.type === "thinking" &&
      typeof block.thinking === "string"
    ) {
      out += `<think>${block.thinking}`;
      if (index !== activeThinkingContentIndex) {
        out += "</think>\n";
      }
    }
  }
  return out;
}

/**
 * Stateful translator. One instance per streamed assistant message.
 *
 * `feed` returns the chunks to send for a single pi event, in order. The
 * caller sends them via safeSend with its own chatId/invocationRef stamping;
 * this module only fills the content-bearing fields.
 */
export class ChatEventTranslator {
  private readonly chatId: number;
  private readonly streamingMessageId: number;

  /** Full assistant text last reflected to the renderer. */
  private lastSentContent = "";
  /** Completed assistant text and tool XML, in transcript order. */
  private readonly committedContent: string[] = [];
  /** Text from the assistant message currently being streamed. */
  private activeAssistantText = "";
  /** Content index for an in-progress pi thinking block. */
  private activeThinkingContentIndex: number | undefined;
  /** Live preview XML from the currently-running tool, if any. */
  private activeToolXml: string | undefined;
  /** Tool call currently owning the single preview overlay. */
  private activeToolCallId: string | undefined;

  constructor(options: EventTranslatorOptions) {
    this.chatId = options.chatId;
    this.streamingMessageId = options.streamingMessageId;
  }

  /** Compose the full renderer-visible content: assistant text + completed tool XML. */
  private composeContent(): string {
    const parts = [...this.committedContent];
    if (this.activeAssistantText) parts.push(this.activeAssistantText);
    return parts.join("\n");
  }

  /** Build a text-patch chunk for the current composed content, or null if unchanged. */
  private textChunk(): ChatResponseChunk | null {
    const full = this.composeContent();
    const patch = computeStreamingPatch(full, this.lastSentContent);
    if (!patch) return null;
    this.lastSentContent = full;
    return {
      chatId: this.chatId,
      streamingMessageId: this.streamingMessageId,
      streamingPatch: patch,
    };
  }

  /** Build a preview-overlay chunk for the active tool's XML (or clear it). */
  private previewChunk(content: string): ChatResponseChunk {
    return {
      chatId: this.chatId,
      streamingMessageId: this.streamingMessageId,
      streamingPreview: { content },
    };
  }

  feed(event: AgentEvent): ChatResponseChunk[] {
    switch (event.type) {
      case "message_update": {
        const update = event.assistantMessageEvent;
        if (
          update.type === "thinking_start" ||
          update.type === "thinking_delta"
        ) {
          this.activeThinkingContentIndex = update.contentIndex;
        } else if (update.type === "thinking_end") {
          this.activeThinkingContentIndex = undefined;
        }

        // The assistant message accumulates content across deltas; recompute
        // the tail patch against the latest full content.
        const content = accumulatedContent(
          event.message as {
            content?: Array<{
              type: string;
              text?: string;
              thinking?: string;
            }>;
          },
          this.activeThinkingContentIndex,
        );
        this.activeAssistantText = content;
        const chunk = this.textChunk();
        return chunk ? [chunk] : [];
      }
      case "message_end": {
        if (event.message.role !== "assistant") return [];

        const message = event.message as {
          content?: Array<{
            type: string;
            text?: string;
            thinking?: string;
          }>;
          stopReason?: string;
        };
        this.activeThinkingContentIndex = undefined;
        this.activeAssistantText = accumulatedContent(message, undefined);
        if (
          message.stopReason !== "error" &&
          message.stopReason !== "aborted" &&
          this.activeAssistantText
        ) {
          this.committedContent.push(this.activeAssistantText);
          this.activeAssistantText = "";
        }
        const chunk = this.textChunk();
        return chunk ? [chunk] : [];
      }
      case "tool_execution_start": {
        this.activeToolCallId = event.toolCallId;
        if (this.activeToolXml) {
          this.activeToolXml = undefined;
          return [this.previewChunk("")];
        }
        return [];
      }
      case "tool_execution_update": {
        if (
          this.activeToolCallId &&
          this.activeToolCallId !== event.toolCallId
        ) {
          return [];
        }
        // Surface the tool's in-progress XML (if the adapter streamed any) as a
        // preview overlay. The partialResult carries AdaptedToolDetails.
        const details = (
          event.partialResult as { details?: AdaptedToolDetails }
        )?.details;
        const xml = details?.xml;
        if (xml && xml !== this.activeToolXml) {
          this.activeToolCallId = event.toolCallId;
          this.activeToolXml = xml;
          return [this.previewChunk(xml)];
        }
        return [];
      }
      case "tool_execution_end": {
        if (
          this.activeToolCallId &&
          this.activeToolCallId !== event.toolCallId
        ) {
          return [];
        }
        // Fold the completed tool's final XML into the transcript and clear the
        // preview overlay.
        const details = (event.result as { details?: AdaptedToolDetails })
          ?.details;
        const xml = details?.xml;
        const chunks: ChatResponseChunk[] = [];
        if (xml) {
          this.committedContent.push(xml);
          const textChunk = this.textChunk();
          if (textChunk) chunks.push(textChunk);
        }
        // Clear the live preview overlay.
        this.activeToolCallId = undefined;
        this.activeToolXml = undefined;
        chunks.push(this.previewChunk(""));
        return chunks;
      }
      default:
        return [];
    }
  }

  /** Remove the failed assistant text before retrying its provider call. */
  discardActiveAssistant(): ChatResponseChunk[] {
    this.activeAssistantText = "";
    const chunk = this.textChunk();
    return chunk ? [chunk] : [];
  }

  /** Append app-owned status XML after the provider turn has settled. */
  appendCommittedContent(content: string): ChatResponseChunk[] {
    this.activeAssistantText = "";
    this.committedContent.push(content);
    const chunk = this.textChunk();
    return chunk ? [chunk] : [];
  }

  /** The final assistant content string (assistant text + tool XML). */
  finalContent(): string {
    return this.composeContent();
  }
}
