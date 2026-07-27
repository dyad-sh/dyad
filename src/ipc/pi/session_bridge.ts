/**
 * pi session bridge.
 *
 * Dyad persists chat history in its own sqlite `messages` table; pi's `Agent`
 * keeps the transcript in memory. This module rebuilds a pi `AgentMessage[]`
 * from Dyad's DB rows so a freshly constructed `Agent` can resume an existing
 * chat (on app restart / chat switch).
 *
 * New turns use a versioned pi envelope in the existing `aiMessagesJson`
 * column. Legacy AI-SDK payloads are converted when possible; malformed or
 * unknown payloads safely fall back to the row's display `role` + `content`.
 */

import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type {
  AssistantMessage,
  ImageContent,
  TextContent,
  ThinkingContent,
  ToolCall,
  ToolResultMessage,
  UserMessage,
} from "@earendil-works/pi-ai";
import { escapeXmlAttr } from "../../../shared/xmlEscape";
import { getPostCompactionMessages } from "@/ipc/handlers/compaction/compaction_utils";

export const PI_TRANSCRIPT_VERSION = 1 as const;

export interface PiTranscriptV1 {
  runtime: "pi";
  version: typeof PI_TRANSCRIPT_VERSION;
  messages: AgentMessage[];
}

/** Wrap a pi transcript in the versioned shape stored in ai_messages_json. */
export function serializePiTranscript(
  messages: readonly AgentMessage[],
): PiTranscriptV1 {
  return {
    runtime: "pi",
    version: PI_TRANSCRIPT_VERSION,
    messages: [...messages],
  };
}

/** Read a current pi transcript envelope, rejecting other or malformed data. */
export function parsePiTranscript(value: unknown): AgentMessage[] | null {
  if (
    !value ||
    typeof value !== "object" ||
    (value as Record<string, unknown>).runtime !== "pi" ||
    (value as Record<string, unknown>).version !== PI_TRANSCRIPT_VERSION
  ) {
    return null;
  }

  const messages = (value as Record<string, unknown>).messages;
  if (!Array.isArray(messages) || !messages.every(isAgentMessage)) {
    return null;
  }
  return messages;
}

function isAgentMessage(value: unknown): value is AgentMessage {
  if (!value || typeof value !== "object") {
    return false;
  }
  const message = value as Record<string, unknown>;
  if (!isFiniteNumber(message.timestamp)) {
    return false;
  }

  if (message.role === "user") {
    return (
      typeof message.content === "string" ||
      (Array.isArray(message.content) &&
        message.content.every(
          (part) => isTextContent(part) || isImageContent(part),
        ))
    );
  }

  if (message.role === "assistant") {
    return (
      Array.isArray(message.content) &&
      message.content.every(
        (part) =>
          isTextContent(part) || isThinkingContent(part) || isToolCall(part),
      ) &&
      typeof message.api === "string" &&
      typeof message.provider === "string" &&
      typeof message.model === "string" &&
      isUsage(message.usage) &&
      ["stop", "length", "toolUse", "error", "aborted"].includes(
        String(message.stopReason),
      )
    );
  }

  return (
    message.role === "toolResult" &&
    typeof message.toolCallId === "string" &&
    typeof message.toolName === "string" &&
    Array.isArray(message.content) &&
    message.content.every(
      (part) => isTextContent(part) || isImageContent(part),
    ) &&
    typeof message.isError === "boolean"
  );
}

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || typeof value === "string";
}

function isTextContent(value: unknown): value is TextContent {
  return (
    isRecord(value) &&
    value.type === "text" &&
    typeof value.text === "string" &&
    isOptionalString(value.textSignature)
  );
}

function isImageContent(value: unknown): value is ImageContent {
  return (
    isRecord(value) &&
    value.type === "image" &&
    typeof value.data === "string" &&
    typeof value.mimeType === "string"
  );
}

function isThinkingContent(value: unknown): value is ThinkingContent {
  return (
    isRecord(value) &&
    value.type === "thinking" &&
    typeof value.thinking === "string" &&
    isOptionalString(value.thinkingSignature) &&
    (value.redacted === undefined || typeof value.redacted === "boolean")
  );
}

function isToolCall(value: unknown): value is ToolCall {
  return (
    isRecord(value) &&
    value.type === "toolCall" &&
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    isRecord(value.arguments) &&
    isOptionalString(value.thoughtSignature)
  );
}

function isUsage(value: unknown): value is AssistantMessage["usage"] {
  if (!isRecord(value) || !isRecord(value.cost)) {
    return false;
  }
  return [
    value.input,
    value.output,
    value.cacheRead,
    value.cacheWrite,
    value.totalTokens,
    value.cost.input,
    value.cost.output,
    value.cost.cacheRead,
    value.cost.cacheWrite,
    value.cost.total,
  ].every(isFiniteNumber);
}

function getLegacyMessages(value: unknown): JsonRecord[] | null {
  if (Array.isArray(value)) {
    return value.every(isRecord) ? value : null;
  }
  if (!isRecord(value) || typeof value.sdkVersion !== "string") {
    return null;
  }
  if (!value.sdkVersion.startsWith("ai@") || !Array.isArray(value.messages)) {
    return null;
  }
  return value.messages.every(isRecord) ? value.messages : null;
}

function zeroUsage(): AssistantMessage["usage"] {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

function findLegacySignature(part: JsonRecord): string | undefined {
  for (const key of [
    "thinkingSignature",
    "thoughtSignature",
    "signature",
    "reasoningEncryptedContent",
  ]) {
    if (typeof part[key] === "string") {
      return part[key];
    }
  }

  for (const containerName of ["providerMetadata", "providerOptions"]) {
    const container = part[containerName];
    if (!isRecord(container)) continue;
    for (const providerData of Object.values(container)) {
      if (!isRecord(providerData)) continue;
      for (const key of [
        "thinkingSignature",
        "thoughtSignature",
        "signature",
        "reasoningEncryptedContent",
      ]) {
        if (typeof providerData[key] === "string") {
          return providerData[key];
        }
      }
    }
  }
  return undefined;
}

function toLegacyImage(part: JsonRecord): ImageContent | null {
  if (typeof part.image !== "string") {
    return null;
  }

  const dataUrl = /^data:([^;,]+);base64,(.*)$/s.exec(part.image);
  const mimeType =
    typeof part.mediaType === "string" ? part.mediaType : dataUrl?.[1];
  if (!mimeType) {
    return null;
  }
  return {
    type: "image",
    data: dataUrl?.[2] ?? part.image,
    mimeType,
  };
}

function convertLegacyUserContent(
  content: unknown,
): UserMessage["content"] | null {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return null;
  }

  const converted: Array<TextContent | ImageContent> = [];
  for (const part of content) {
    if (!isRecord(part)) continue;
    if (part.type === "text" && typeof part.text === "string") {
      converted.push({ type: "text", text: part.text });
    } else if (part.type === "image") {
      const image = toLegacyImage(part);
      if (image) converted.push(image);
    }
  }
  return converted;
}

function convertLegacyAssistantContent(
  content: unknown,
): AssistantMessage["content"] | null {
  if (typeof content === "string") {
    return content ? [{ type: "text", text: content }] : [];
  }
  if (!Array.isArray(content)) {
    return null;
  }

  const converted: Array<TextContent | ThinkingContent | ToolCall> = [];
  for (const part of content) {
    if (!isRecord(part)) continue;
    if (part.type === "text" && typeof part.text === "string") {
      converted.push({ type: "text", text: part.text });
      continue;
    }
    if (part.type === "reasoning" && typeof part.text === "string") {
      converted.push({
        type: "thinking",
        thinking: part.text,
        ...(findLegacySignature(part)
          ? { thinkingSignature: findLegacySignature(part) }
          : {}),
      });
      continue;
    }
    if (
      part.type === "tool-call" &&
      typeof part.toolCallId === "string" &&
      typeof part.toolName === "string"
    ) {
      const signature = findLegacySignature(part);
      converted.push({
        type: "toolCall",
        id: part.toolCallId,
        name: part.toolName,
        arguments: isRecord(part.input) ? part.input : {},
        ...(signature ? { thoughtSignature: signature } : {}),
      });
    }
  }
  return converted;
}

function stringifyLegacyValue(value: unknown): string {
  if (typeof value === "string") return value;
  return JSON.stringify(value ?? null, null, 2);
}

function convertLegacyToolResult(
  part: JsonRecord,
  timestamp: number,
): ToolResultMessage | null {
  if (
    part.type !== "tool-result" ||
    typeof part.toolCallId !== "string" ||
    typeof part.toolName !== "string"
  ) {
    return null;
  }

  const output = isRecord(part.output) ? part.output : null;
  const outputType = typeof output?.type === "string" ? output.type : "";
  const outputValue = output && "value" in output ? output.value : part.result;
  return {
    role: "toolResult",
    toolCallId: part.toolCallId,
    toolName: part.toolName,
    content: [{ type: "text", text: stringifyLegacyValue(outputValue) }],
    isError: Boolean(part.isError) || outputType.startsWith("error-"),
    timestamp,
  };
}

function parseLegacyAiTranscript(
  value: unknown,
  row: DyadMessageRow,
): AgentMessage[] | null {
  const legacyMessages = getLegacyMessages(value);
  if (!legacyMessages) {
    return null;
  }

  const baseTimestamp = toTimestamp(row.createdAt);
  const converted: AgentMessage[] = [];
  for (let index = 0; index < legacyMessages.length; index++) {
    const message = legacyMessages[index];
    const timestamp = baseTimestamp + index;
    if (message.role === "user") {
      const content = convertLegacyUserContent(message.content);
      if (content !== null) {
        converted.push({ role: "user", content, timestamp });
      }
      continue;
    }
    if (message.role === "assistant") {
      const content = convertLegacyAssistantContent(message.content);
      if (content !== null) {
        converted.push({
          role: "assistant",
          content,
          api: "openai-completions",
          provider: "unknown",
          model: row.model ?? "unknown",
          usage: zeroUsage(),
          stopReason: content.some((part) => part.type === "toolCall")
            ? "toolUse"
            : "stop",
          timestamp,
        });
      }
      continue;
    }
    if (message.role === "tool" && Array.isArray(message.content)) {
      for (const part of message.content) {
        if (!isRecord(part)) continue;
        const toolResult = convertLegacyToolResult(part, timestamp);
        if (toolResult) converted.push(toolResult);
      }
    }
  }
  return converted;
}

function getAssistantToolCalls(message: AgentMessage): ToolCall[] {
  if (message.role !== "assistant") return [];
  return message.content.filter(
    (part): part is ToolCall => part.type === "toolCall",
  );
}

function interruptedToolResult(
  assistant: AssistantMessage,
  toolCall: ToolCall,
  index: number,
): ToolResultMessage {
  return {
    role: "toolResult",
    toolCallId: toolCall.id,
    toolName: toolCall.name,
    content: [
      {
        type: "text",
        text: "Tool execution was interrupted before a result was recorded.",
      },
    ],
    details: { interrupted: true },
    isError: true,
    timestamp: assistant.timestamp + index + 1,
  };
}

/**
 * Canonicalize pi tool history for providers such as Anthropic that require
 * every assistant tool call to be immediately followed by its result. Missing
 * results are represented explicitly instead of deleting the interrupted call.
 */
export function repairToolCallTranscript(
  messages: readonly AgentMessage[],
): AgentMessage[] {
  const repaired: AgentMessage[] = [];

  for (let index = 0; index < messages.length; index++) {
    const message = messages[index];
    if (message.role === "toolResult") {
      continue;
    }

    const toolCalls = getAssistantToolCalls(message);
    if (message.role !== "assistant" || toolCalls.length === 0) {
      repaired.push(message);
      continue;
    }

    let scanEnd = index + 1;
    while (
      scanEnd < messages.length &&
      messages[scanEnd].role !== "assistant"
    ) {
      scanEnd++;
    }

    const resultsByCallId = new Map<string, ToolResultMessage>();
    const interveningMessages: AgentMessage[] = [];
    for (let cursor = index + 1; cursor < scanEnd; cursor++) {
      const candidate = messages[cursor];
      if (candidate.role === "toolResult") {
        if (!resultsByCallId.has(candidate.toolCallId)) {
          resultsByCallId.set(candidate.toolCallId, candidate);
        }
      } else {
        interveningMessages.push(candidate);
      }
    }

    repaired.push(message);
    repaired.push(
      ...toolCalls.map(
        (toolCall, toolIndex) =>
          resultsByCallId.get(toolCall.id) ??
          interruptedToolResult(message, toolCall, toolIndex),
      ),
    );
    repaired.push(...interveningMessages);
    index = scanEnd - 1;
  }

  return repaired;
}

function selectRestorableRows(
  rows: readonly DyadMessageRow[],
): DyadMessageRow[] {
  if (!rows.every((row) => typeof row.id === "number")) {
    return [...rows];
  }

  const relevant = getPostCompactionMessages(
    rows.map((row) => ({
      ...row,
      id: row.id!,
      isCompactionSummary: row.isCompactionSummary ?? null,
    })),
  );
  const reordered: DyadMessageRow[] = [...relevant];

  for (const summary of [...reordered].filter(
    (row) => row.isCompactionSummary,
  )) {
    const summaryIndex = reordered.findIndex((row) => row.id === summary.id);
    const triggeringUser = [...reordered]
      .filter(
        (row) =>
          row.role === "user" &&
          typeof row.id === "number" &&
          typeof summary.id === "number" &&
          row.id < summary.id,
      )
      .sort((a, b) => (b.id ?? 0) - (a.id ?? 0))[0];
    if (!triggeringUser || summaryIndex < 0) continue;

    const triggeringUserIndex = reordered.findIndex(
      (row) => row.id === triggeringUser.id,
    );
    if (
      triggeringUserIndex < 0 ||
      toTimestamp(summary.createdAt) < toTimestamp(triggeringUser.createdAt) ||
      summaryIndex === triggeringUserIndex + 1
    ) {
      continue;
    }

    reordered.splice(summaryIndex, 1);
    reordered.splice(triggeringUserIndex + 1, 0, summary);
  }

  return reordered;
}

/** Shape of a Dyad DB message row needed to restore a pi session. */
export interface DyadMessageRow {
  id?: number;
  role: "user" | "assistant";
  content: string;
  aiMessagesJson?: unknown;
  model?: string | null;
  createdAt?: Date | number | null;
  sourceCommitHash?: string | null;
  commitHash?: string | null;
  isCompactionSummary?: boolean | null;
}

function toTimestamp(createdAt: DyadMessageRow["createdAt"]): number {
  if (createdAt instanceof Date) {
    return createdAt.getTime();
  }
  if (typeof createdAt === "number") {
    // DB stores unix seconds; pi expects ms.
    return createdAt < 1e12 ? createdAt * 1000 : createdAt;
  }
  return Date.now();
}

function toUserMessage(row: DyadMessageRow): UserMessage {
  return {
    role: "user",
    content: row.content,
    timestamp: toTimestamp(row.createdAt),
  };
}

function toAssistantMessage(row: DyadMessageRow): AssistantMessage {
  return {
    role: "assistant",
    content: row.content ? [{ type: "text", text: row.content }] : [],
    api: "openai-completions",
    provider: "unknown",
    model: row.model ?? "unknown",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: toTimestamp(row.createdAt),
  };
}

function getGitAnnotation(row: DyadMessageRow): string | null {
  if (row.commitHash) {
    return `<dyad-git-context commit="${escapeXmlAttr(row.commitHash)}"></dyad-git-context>`;
  }
  if (row.sourceCommitHash) {
    return `<dyad-git-context source_commit="${escapeXmlAttr(row.sourceCommitHash)}" no_commit="true"></dyad-git-context>`;
  }
  return null;
}

function appendGitAnnotation(
  messages: AgentMessage[],
  annotation: string | null,
): AgentMessage[] {
  if (!annotation) {
    return messages;
  }

  let assistantIndex = -1;
  for (let index = messages.length - 1; index >= 0; index--) {
    if (messages[index].role === "assistant") {
      assistantIndex = index;
      break;
    }
  }
  if (assistantIndex < 0) {
    return messages;
  }

  const assistant = messages[assistantIndex] as AssistantMessage;
  const annotated = [...messages];
  annotated[assistantIndex] = {
    ...assistant,
    content: [...assistant.content, { type: "text", text: annotation }],
  };
  return annotated;
}

/** Rebuild a pi transcript from Dyad DB message rows. */
export function rebuildAgentMessages(
  rows: readonly DyadMessageRow[],
): AgentMessage[] {
  const out: AgentMessage[] = [];
  for (const row of selectRestorableRows(rows)) {
    const storedMessages =
      parsePiTranscript(row.aiMessagesJson) ??
      parseLegacyAiTranscript(row.aiMessagesJson, row);
    if (storedMessages) {
      out.push(...appendGitAnnotation(storedMessages, getGitAnnotation(row)));
      continue;
    }

    if (row.role === "user") {
      out.push(toUserMessage(row));
    } else {
      out.push(
        ...appendGitAnnotation(
          [toAssistantMessage(row)],
          getGitAnnotation(row),
        ),
      );
    }
  }
  return repairToolCallTranscript(out);
}
