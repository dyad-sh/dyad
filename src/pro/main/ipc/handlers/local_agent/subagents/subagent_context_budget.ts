import type {
  AssistantModelMessage,
  ModelMessage,
  TextPart,
  ToolModelMessage,
  ToolResultPart,
} from "ai";
import type { SubagentThreadSummary } from "@/ipc/types";

/**
 * Context budget for sub-agent conversations.
 *
 * The AI SDK re-sends the *entire* accumulated transcript on every step of a
 * step loop. Without an explicit budget the request size grows quadratically
 * with the step count, and a single large tool result (`read_file`, `grep`,
 * `git diff`, ...) is enough to dominate the request.
 *
 * The root agent already has a mid-turn compaction pass; sub-agents did not.
 * These limits are applied to what is *sent to the model* only. The durable
 * copies stored in the database and rendered in the UI are never truncated
 * here, so nothing is lost — the model simply receives a bounded excerpt.
 */

/** Maximum characters kept for a single tool result inside a sub-agent turn. */
export const MAX_SUBAGENT_TOOL_RESULT_CHARS = 12_000;

/** Maximum characters kept for ALL tool results combined in a sub-agent turn. */
export const MAX_SUBAGENT_TOTAL_TOOL_RESULT_CHARS = 60_000;

/** Maximum characters of a single sub-agent report injected into the parent. */
export const MAX_PARENT_REPORT_CHARS = 12_000;

/**
 * Maximum characters of assistant prose kept across a whole sub-agent turn.
 * The newest assistant text always survives; older prose is replaced by a
 * short placeholder so the transcript stays valid.
 */
export const MAX_SUBAGENT_TOTAL_ASSISTANT_TEXT_CHARS = 20_000;

/** Maximum characters of ALL sub-agent reports injected into the parent. */
export const MAX_PARENT_TOTAL_REPORT_CHARS = 30_000;

/** Maximum characters of the echoed assignment injected into the parent. */
export const MAX_PARENT_ASSIGNMENT_CHARS = 2_000;

/**
 * Maximum characters of the assignment handed to a sub-agent, including the
 * advisory scope list appended by `buildSubagentAssignment`. The assignment
 * is re-sent on every step of the turn, so it must stay small.
 */
export const MAX_SUBAGENT_ASSIGNMENT_CHARS = 8_000;

/**
 * Maximum characters of a *replacement* assignment (for example the reviewer's
 * diff, or a follow-up instruction) that is re-sent on every step of a turn.
 */
export const MAX_SUBAGENT_CURRENT_ASSIGNMENT_CHARS = 40_000;

/** Maximum characters kept for a single tool result inside a root-agent turn. */
export const MAX_ROOT_TOOL_RESULT_CHARS = 30_000;

/** Maximum characters kept for ALL tool results combined in a root-agent turn. */
export const MAX_ROOT_TOTAL_TOOL_RESULT_CHARS = 150_000;

/**
 * Minimum number of characters reserved for the conversational history of a
 * sub-agent turn. The assignments are re-sent on every step, so without a
 * floor a large assignment would consume the whole history budget and wipe
 * the sub-agent's memory.
 */
export const MIN_SUBAGENT_HISTORY_CHARS = 12_000;

const OMITTED_TOOL_RESULT_MARKER =
  "[omitted: earlier tool result dropped to fit the sub-agent context budget]";

const OMITTED_REPORT_MARKER =
  "[report omitted to fit the parent context budget]";

const REPORT_TRUNCATION_MARKER =
  "\n\n[... report truncated to fit the parent context budget ...]\n\n";

const TOOL_OUTPUT_TRUNCATION_MARKER = "\n\n[... tool output truncated ...]\n\n";

const OMITTED_ASSISTANT_TEXT_MARKER =
  "[earlier assistant message omitted to fit the sub-agent context budget]";

const ASSIGNMENT_TRUNCATION_MARKER =
  "\n\n[... assignment truncated to fit the sub-agent context budget ...]\n\n";

type ToolResultOutput = ToolResultPart["output"];

function isToolResultPart(part: unknown): part is ToolResultPart {
  if (typeof part !== "object" || part === null) {
    return false;
  }
  const candidate = part as { type?: unknown; toolCallId?: unknown };
  return (
    candidate.type === "tool-result" && typeof candidate.toolCallId === "string"
  );
}

/**
 * Flattens a tool result output into plain text so its size can be measured
 * and truncated regardless of the output variant the provider produced.
 */
export function toolResultOutputToText(
  output: ToolResultOutput | undefined,
): string {
  if (!output || typeof output !== "object") {
    return "";
  }
  switch (output.type) {
    case "text":
    case "error-text":
      return typeof output.value === "string" ? output.value : "";
    case "json":
    case "error-json": {
      try {
        return JSON.stringify(output.value) ?? "";
      } catch {
        return "";
      }
    }
    case "execution-denied":
      return output.reason ?? "";
    case "content": {
      const parts = output.value as Array<{ type: string; text?: string }>;
      return parts
        .map((part) => (typeof part.text === "string" ? part.text : ""))
        .join("\n");
    }
    default:
      return "";
  }
}

/**
 * Keeps the head and the tail of `text` so both the beginning and the
 * conclusion survive. Used for reports (conclusions live at the end) and for
 * tool output (the tail often holds the interesting part).
 */
function truncateWithMarker(
  text: string,
  maxChars: number,
  marker: string,
  headRatio = 0.7,
): string {
  if (text.length <= maxChars) {
    return text;
  }
  if (maxChars <= 0) {
    return "";
  }
  const available = Math.max(0, maxChars - marker.length);
  if (available === 0) {
    return text.slice(0, maxChars);
  }
  const headChars = Math.min(available, Math.ceil(available * headRatio));
  const tailChars = available - headChars;
  if (tailChars <= 0) {
    return `${text.slice(0, available)}${marker}`;
  }
  return `${text.slice(0, headChars)}${marker}${text.slice(text.length - tailChars)}`;
}

function truncateToolOutput(
  output: ToolResultOutput,
  maxChars: number,
): ToolResultOutput {
  const text = toolResultOutputToText(output);
  if (text.length <= maxChars) {
    return output;
  }
  const truncated = truncateWithMarker(
    text,
    maxChars,
    TOOL_OUTPUT_TRUNCATION_MARKER,
  );
  if (output.type === "error-text") {
    return { type: "error-text", value: truncated };
  }
  return { type: "text", value: truncated };
}

interface ToolResultEntry {
  messageIndex: number;
  partIndex: number;
  part: ToolResultPart;
  chars: number;
}

/**
 * Bounds the tool results that a sub-agent sends to the model.
 *
 * - Every individual tool result is capped at `maxToolResultChars`.
 * - The combined size of all tool results is capped at
 *   `maxTotalToolResultChars`. The newest results win; older ones are
 *   replaced by a short placeholder.
 * - Tool results are NEVER removed, only shrunk, so every tool-call keeps
 *   its matching tool-result and the transcript stays valid for providers
 *   that reject unpaired tool calls.
 *
 * Returns the original array when nothing had to be changed.
 */
export function pruneSubagentToolResults(
  messages: ModelMessage[],
  options: {
    maxToolResultChars?: number;
    maxTotalToolResultChars?: number;
  } = {},
): ModelMessage[] {
  const maxToolResultChars =
    options.maxToolResultChars ?? MAX_SUBAGENT_TOOL_RESULT_CHARS;
  const maxTotalToolResultChars =
    options.maxTotalToolResultChars ?? MAX_SUBAGENT_TOTAL_TOOL_RESULT_CHARS;

  const entries: ToolResultEntry[] = [];
  messages.forEach((message, messageIndex) => {
    if (message.role !== "tool") {
      return;
    }
    const content = (message as ToolModelMessage).content;
    if (!Array.isArray(content)) {
      return;
    }
    content.forEach((part, partIndex) => {
      if (!isToolResultPart(part)) {
        return;
      }
      entries.push({
        messageIndex,
        partIndex,
        part,
        chars: toolResultOutputToText(part.output).length,
      });
    });
  });

  if (entries.length === 0) {
    return messages;
  }

  // Newest results win: walk backwards and keep results while the total
  // budget allows. The very newest result is always kept in full (up to the
  // per-result cap) because it is what the model is currently reacting to.
  const keep = Array.from({ length: entries.length }, () => false);
  let used = 0;
  for (let index = entries.length - 1; index >= 0; index--) {
    const chars = Math.min(entries[index].chars, maxToolResultChars);
    const isNewest = index === entries.length - 1;
    if (isNewest || used + chars <= maxTotalToolResultChars) {
      keep[index] = true;
      used += chars;
    }
  }

  const replacements = new Map<number, Map<number, ToolResultPart>>();
  entries.forEach((entry, index) => {
    let next: ToolResultPart | null = null;
    if (!keep[index]) {
      next = {
        ...entry.part,
        output: { type: "text", value: OMITTED_TOOL_RESULT_MARKER },
      };
    } else if (entry.chars > maxToolResultChars) {
      next = {
        ...entry.part,
        output: truncateToolOutput(entry.part.output, maxToolResultChars),
      };
    }
    if (!next) {
      return;
    }
    let byPart = replacements.get(entry.messageIndex);
    if (!byPart) {
      byPart = new Map<number, ToolResultPart>();
      replacements.set(entry.messageIndex, byPart);
    }
    byPart.set(entry.partIndex, next);
  });

  if (replacements.size === 0) {
    return messages;
  }

  return messages.map((message, messageIndex) => {
    const byPart = replacements.get(messageIndex);
    if (!byPart) {
      return message;
    }
    const toolMessage = message as ToolModelMessage;
    const content = [...toolMessage.content];
    for (const [partIndex, part] of byPart) {
      content[partIndex] = part;
    }
    return { ...toolMessage, content };
  });
}

function isTextPart(part: unknown): part is TextPart {
  if (typeof part !== "object" || part === null) {
    return false;
  }
  const candidate = part as { type?: unknown; text?: unknown };
  return candidate.type === "text" && typeof candidate.text === "string";
}

interface AssistantTextEntry {
  messageIndex: number;
  partIndex: number;
  chars: number;
}

/**
 * Bounds the assistant prose carried across the steps of a sub-agent turn.
 *
 * Tool calls and reasoning parts are never touched — only the plain text the
 * model wrote. The newest text is kept in full; older text is replaced by a
 * short placeholder so the message shape stays valid for the provider.
 */
export function pruneSubagentAssistantText(
  messages: ModelMessage[],
  options: { maxTotalTextChars?: number } = {},
): ModelMessage[] {
  const maxTotalTextChars =
    options.maxTotalTextChars ?? MAX_SUBAGENT_TOTAL_ASSISTANT_TEXT_CHARS;

  const entries: AssistantTextEntry[] = [];
  messages.forEach((message, messageIndex) => {
    if (message.role !== "assistant") {
      return;
    }
    const content = (message as AssistantModelMessage).content;
    if (!Array.isArray(content)) {
      return;
    }
    content.forEach((part, partIndex) => {
      if (!isTextPart(part)) {
        return;
      }
      entries.push({ messageIndex, partIndex, chars: part.text.length });
    });
  });

  if (entries.length === 0) {
    return messages;
  }

  const keep = Array.from({ length: entries.length }, () => false);
  let used = 0;
  for (let index = entries.length - 1; index >= 0; index--) {
    const chars = entries[index].chars;
    const isNewest = index === entries.length - 1;
    if (isNewest || used + chars <= maxTotalTextChars) {
      keep[index] = true;
      used += chars;
    }
  }

  const replacements = new Map<number, Map<number, TextPart>>();
  entries.forEach((entry, index) => {
    if (keep[index]) {
      return;
    }
    let byPart = replacements.get(entry.messageIndex);
    if (!byPart) {
      byPart = new Map<number, TextPart>();
      replacements.set(entry.messageIndex, byPart);
    }
    byPart.set(entry.partIndex, {
      type: "text",
      text: OMITTED_ASSISTANT_TEXT_MARKER,
    });
  });

  if (replacements.size === 0) {
    return messages;
  }

  return messages.map((message, messageIndex) => {
    const byPart = replacements.get(messageIndex);
    if (!byPart) {
      return message;
    }
    const assistantMessage = message as AssistantModelMessage;
    if (!Array.isArray(assistantMessage.content)) {
      return message;
    }
    const content = assistantMessage.content.map((part, partIndex) => {
      return byPart.get(partIndex) ?? part;
    });
    return { ...assistantMessage, content };
  });
}

/**
 * Maximum characters kept for a single string value inside a tool-call input
 * (for example the `content` of a `write_file` call, or the `old_string` of a
 * `search_replace` call). The tool already ran with the full value; this only
 * bounds what is re-sent on later steps of the same turn.
 */
export const MAX_TOOL_CALL_INPUT_VALUE_CHARS = 12_000;

/**
 * Maximum characters kept for ALL tool-call inputs combined in one turn.
 */
export const MAX_TOTAL_TOOL_CALL_INPUT_CHARS = 40_000;

/** Maximum characters kept for a single tool-call input value in the root agent. */
export const MAX_ROOT_TOOL_CALL_INPUT_VALUE_CHARS = 20_000;

/** Maximum characters kept for ALL root-agent tool-call inputs combined. */
export const MAX_ROOT_TOTAL_TOOL_CALL_INPUT_CHARS = 60_000;

const TRUNCATED_TOOL_INPUT_MARKER = "[tool input truncated]";
const OMITTED_TOOL_INPUT_MARKER =
  "[earlier tool input omitted to fit the context budget]";

interface ToolCallPartLike {
  type: "tool-call";
  toolCallId: string;
  toolName: string;
  input: unknown;
}

function isToolCallPart(part: unknown): part is ToolCallPartLike {
  if (typeof part !== "object" || part === null) {
    return false;
  }
  const candidate = part as {
    type?: unknown;
    toolCallId?: unknown;
    input?: unknown;
  };
  return (
    candidate.type === "tool-call" &&
    typeof candidate.toolCallId === "string" &&
    typeof candidate.input === "object" &&
    candidate.input !== null
  );
}

interface ToolCallInputEntry {
  messageIndex: number;
  partIndex: number;
  key: string;
  value: string;
  chars: number;
}

/**
 * Bounds the assistant side of the transcript: the arguments the model passed
 * to its tools.
 *
 * A `write_file` call carries the whole file body, a `search_replace` call
 * carries both the old and the new text, and a sandbox script carries its
 * entire source. None of that is bounded by the tool-result budget because it
 * lives in an assistant message, and it is re-sent on every step of the turn.
 */
export function pruneAssistantToolCallInputs(
  messages: ModelMessage[],
  options: {
    maxInputValueChars?: number;
    maxTotalInputChars?: number;
  } = {},
): ModelMessage[] {
  const maxInputValueChars =
    options.maxInputValueChars ?? MAX_TOOL_CALL_INPUT_VALUE_CHARS;
  const maxTotalInputChars =
    options.maxTotalInputChars ?? MAX_TOTAL_TOOL_CALL_INPUT_CHARS;

  const entries: ToolCallInputEntry[] = [];
  messages.forEach((message, messageIndex) => {
    if (message.role !== "assistant") {
      return;
    }
    const content = (message as AssistantModelMessage).content;
    if (!Array.isArray(content)) {
      return;
    }
    content.forEach((part, partIndex) => {
      if (!isToolCallPart(part)) {
        return;
      }
      const input = part.input as Record<string, unknown>;
      for (const [key, value] of Object.entries(input)) {
        if (typeof value !== "string") {
          continue;
        }
        entries.push({
          messageIndex,
          partIndex,
          key,
          value,
          chars: value.length,
        });
      }
    });
  });

  if (entries.length === 0) {
    return messages;
  }

  // Newest first: the most recent tool call keeps its input, older ones are
  // dropped from the budget once it is exhausted.
  const keep = Array.from({ length: entries.length }, () => false);
  let used = 0;
  for (let index = entries.length - 1; index >= 0; index--) {
    const chars = Math.min(entries[index].chars, maxInputValueChars);
    const isNewest = index === entries.length - 1;
    if (isNewest || used + chars <= maxTotalInputChars) {
      keep[index] = true;
      used += chars;
    }
  }

  // messageIndex -> partIndex -> key -> replacement value
  const replacements = new Map<number, Map<number, Map<string, string>>>();
  let changed = false;
  entries.forEach((entry, index) => {
    let replacement: string;
    if (!keep[index]) {
      replacement = OMITTED_TOOL_INPUT_MARKER;
    } else if (entry.chars > maxInputValueChars) {
      replacement = truncateWithMarker(
        entry.value,
        maxInputValueChars,
        TRUNCATED_TOOL_INPUT_MARKER,
      );
    } else {
      return;
    }
    changed = true;
    let byPart = replacements.get(entry.messageIndex);
    if (!byPart) {
      byPart = new Map<number, Map<string, string>>();
      replacements.set(entry.messageIndex, byPart);
    }
    let byKey = byPart.get(entry.partIndex);
    if (!byKey) {
      byKey = new Map<string, string>();
      byPart.set(entry.partIndex, byKey);
    }
    byKey.set(entry.key, replacement);
  });

  if (!changed) {
    return messages;
  }

  return messages.map((message, messageIndex) => {
    const byPart = replacements.get(messageIndex);
    if (!byPart) {
      return message;
    }
    const assistantMessage = message as AssistantModelMessage;
    if (!Array.isArray(assistantMessage.content)) {
      return message;
    }
    const content = assistantMessage.content.map((part, partIndex) => {
      const byKey = byPart.get(partIndex);
      if (!byKey) {
        return part;
      }
      const toolCall = part as ToolCallPartLike;
      const input = {
        ...(toolCall.input as Record<string, unknown>),
      };
      for (const [key, value] of byKey) {
        input[key] = value;
      }
      return { ...toolCall, input };
    });
    return { ...assistantMessage, content };
  });
}

/**
 * Applies the full sub-agent context budget to a step's messages: tool
 * results are bounded, tool-call inputs are bounded and older assistant prose
 * is dropped.
 */
export function pruneSubagentMessages(
  messages: ModelMessage[],
  options: {
    maxToolResultChars?: number;
    maxTotalToolResultChars?: number;
    maxTotalAssistantTextChars?: number;
    maxToolCallInputValueChars?: number;
    maxTotalToolCallInputChars?: number;
  } = {},
): ModelMessage[] {
  const afterToolResults = pruneSubagentToolResults(messages, {
    maxToolResultChars: options.maxToolResultChars,
    maxTotalToolResultChars: options.maxTotalToolResultChars,
  });
  const afterInputs = pruneAssistantToolCallInputs(afterToolResults, {
    maxInputValueChars: options.maxToolCallInputValueChars,
    maxTotalInputChars: options.maxTotalToolCallInputChars,
  });
  return pruneSubagentAssistantText(afterInputs, {
    maxTotalTextChars: options.maxTotalAssistantTextChars,
  });
}

/**
 * The root agent's context budget.
 *
 * The root agent already compacts mid-turn, but compaction is reactive: it
 * happens *after* an oversized payload has already gone out. This bounds what
 * every single request carries: tool results, the arguments the model passed
 * to its tools, and the assistant's own prose.
 */
export function pruneRootMessages(
  messages: ModelMessage[],
  options: {
    maxToolResultChars?: number;
    maxTotalToolResultChars?: number;
    maxTotalAssistantTextChars?: number;
    maxToolCallInputValueChars?: number;
    maxTotalToolCallInputChars?: number;
  } = {},
): ModelMessage[] {
  const afterToolResults = pruneSubagentToolResults(messages, {
    maxToolResultChars:
      options.maxToolResultChars ?? MAX_ROOT_TOOL_RESULT_CHARS,
    maxTotalToolResultChars:
      options.maxTotalToolResultChars ?? MAX_ROOT_TOTAL_TOOL_RESULT_CHARS,
  });
  const afterInputs = pruneAssistantToolCallInputs(afterToolResults, {
    maxInputValueChars:
      options.maxToolCallInputValueChars ??
      MAX_ROOT_TOOL_CALL_INPUT_VALUE_CHARS,
    maxTotalInputChars:
      options.maxTotalToolCallInputChars ??
      MAX_ROOT_TOTAL_TOOL_CALL_INPUT_CHARS,
  });
  return pruneSubagentAssistantText(afterInputs, {
    maxTotalTextChars:
      options.maxTotalAssistantTextChars ??
      MAX_SUBAGENT_TOTAL_ASSISTANT_TEXT_CHARS,
  });
}

/**
 * Bounds a sub-agent report before it is injected into the parent agent's
 * context. The head and the tail are kept so the summary and the conclusion
 * both survive.
 */
export function boundReportForParent(
  report: string,
  maxChars: number = MAX_PARENT_REPORT_CHARS,
): string {
  if (typeof report !== "string") {
    return "";
  }
  if (report.length <= maxChars) {
    return report;
  }
  return truncateWithMarker(report, maxChars, REPORT_TRUNCATION_MARKER, 0.6);
}

function withBoundedField(
  summary: SubagentThreadSummary,
  updates: Partial<Record<"assignment" | "error", string | null>>,
): SubagentThreadSummary {
  const next: SubagentThreadSummary = { ...summary };
  if (updates.assignment !== undefined) {
    next.assignment = updates.assignment ?? summary.assignment;
  }
  if (updates.error !== undefined) {
    next.error = updates.error;
  }
  return next;
}

/**
 * Bounds the sub-agent summaries that are handed back to the parent agent.
 *
 * The parent agent already knows the assignment it wrote and the report stays
 * available in the database and in the sub-agent panel, so the parent-facing
 * view is a bounded excerpt instead of the full durable payload.
 */
export function boundSubagentSummariesForParent(
  summaries: readonly SubagentThreadSummary[],
  options: {
    perReportChars?: number;
    totalReportChars?: number;
    maxAssignmentChars?: number;
  } = {},
): SubagentThreadSummary[] {
  const perReportChars = options.perReportChars ?? MAX_PARENT_REPORT_CHARS;
  const totalReportChars =
    options.totalReportChars ?? MAX_PARENT_TOTAL_REPORT_CHARS;
  const maxAssignmentChars =
    options.maxAssignmentChars ?? MAX_PARENT_ASSIGNMENT_CHARS;

  // Reserve room for a single "report omitted" marker so the total budget
  // stays a hard cap even when several reports have to be dropped.
  const reserve =
    totalReportChars >= OMITTED_REPORT_MARKER.length * 2
      ? OMITTED_REPORT_MARKER.length
      : 0;
  let remaining = Math.max(0, totalReportChars - reserve);
  let omissionMarkerEmitted = false;

  return summaries.map((summary) => {
    const report = summary.result?.report;
    const hasReport = typeof report === "string" && report.length > 0;

    let boundedReport: string | undefined;
    if (hasReport) {
      if (remaining <= 0) {
        if (reserve > 0 && !omissionMarkerEmitted) {
          boundedReport = OMITTED_REPORT_MARKER;
          omissionMarkerEmitted = true;
        } else {
          boundedReport = "";
        }
      } else {
        boundedReport = boundReportForParent(
          report,
          Math.min(perReportChars, remaining),
        );
        remaining -= boundedReport.length;
      }
    }

    const next = withBoundedField(summary, {
      assignment:
        summary.assignment.length > maxAssignmentChars
          ? `${summary.assignment.slice(0, maxAssignmentChars)}\n[assignment truncated]`
          : summary.assignment,
      error:
        summary.error && summary.error.length > maxAssignmentChars
          ? `${summary.error.slice(0, maxAssignmentChars)}\n[error truncated]`
          : summary.error,
    });

    if (boundedReport === undefined) {
      return next;
    }

    const result: Record<string, unknown> = {};
    if (summary.result) {
      for (const [key, value] of Object.entries(summary.result)) {
        result[key] = value;
      }
    }
    result.report = boundedReport;
    return { ...next, result };
  });
}

/**
 * Bounds a single assignment so it can be re-sent on every step of a turn
 * without dominating the request. The head and the tail are kept so both the
 * task statement and any trailing advisory list survive.
 */
export function boundAssignmentForModel(
  assignment: string,
  maxChars: number = MAX_SUBAGENT_ASSIGNMENT_CHARS,
): string {
  if (assignment.length <= maxChars) {
    return assignment;
  }
  return truncateWithMarker(
    assignment,
    maxChars,
    ASSIGNMENT_TRUNCATION_MARKER,
    0.6,
  );
}

/**
 * Bounds both the original and the current (replacement) assignment that a
 * sub-agent turn carries. The original assignment is the task statement, the
 * current one may be a large replacement such as a review diff.
 */
export function boundSubagentAssignmentsForModel(params: {
  originalAssignment: string;
  currentAssignment: string;
  maxOriginalChars?: number;
  maxCurrentChars?: number;
}): { originalAssignment: string; currentAssignment: string } {
  const maxOriginalChars =
    params.maxOriginalChars ?? MAX_SUBAGENT_ASSIGNMENT_CHARS;
  const maxCurrentChars =
    params.maxCurrentChars ?? MAX_SUBAGENT_CURRENT_ASSIGNMENT_CHARS;
  return {
    originalAssignment: boundAssignmentForModel(
      params.originalAssignment,
      maxOriginalChars,
    ),
    currentAssignment: boundAssignmentForModel(
      params.currentAssignment,
      maxCurrentChars,
    ),
  };
}

/**
 * Hard ceiling on the characters of chat history that is handed to the model.
 *
 * The compaction threshold is a token budget that can legitimately reach a
 * million characters before compaction fires. This is a much smaller hard
 * bound, applied to the history that is actually sent, so a long-running chat
 * cannot ship an unbounded transcript on every step.
 */
export const MAX_ROOT_HISTORY_CHARS = 200_000;

function measureMessageChars(message: ModelMessage): number {
  const content = message.content;
  if (typeof content === "string") {
    return content.length;
  }
  if (!Array.isArray(content)) {
    return 0;
  }
  let chars = 0;
  // Providers can send plain strings inside the content array even though the
  // SDK types only describe object parts, so measure the parts untyped.
  for (const part of content as unknown[]) {
    if (typeof part === "string") {
      chars += part.length;
      continue;
    }
    if (part && typeof part === "object" && "text" in part) {
      chars += String((part as { text?: unknown }).text ?? "").length;
    }
  }
  return chars;
}

/**
 * Drops the oldest messages of a chat history until it fits the budget.
 *
 * System messages are never dropped: they carry the rules the model must
 * follow. Everything else is dropped oldest-first.
 */
export function boundChatHistoryForModel(
  history: ModelMessage[],
  maxChars: number = MAX_ROOT_HISTORY_CHARS,
): ModelMessage[] {
  if (history.length === 0) {
    return history;
  }

  let total = history.reduce(
    (sum, message) => sum + measureMessageChars(message),
    0,
  );
  if (total <= maxChars) {
    return history;
  }

  const keep = Array.from({ length: history.length }, () => true);
  for (let index = 0; index < history.length && total > maxChars; index++) {
    const message = history[index];
    if (message.role === "system") {
      continue;
    }
    keep[index] = false;
    total -= measureMessageChars(message);
  }

  return history.filter((_, index) => keep[index]);
}
