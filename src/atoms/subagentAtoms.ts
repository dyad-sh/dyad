import { atom } from "jotai";

import { previewModeAtom } from "@/atoms/appAtoms";
import {
  chatMessagesByIdAtom,
  isStreamingByIdAtom,
  selectedChatIdAtom,
  streamingPreviewByChatIdAtom,
} from "@/atoms/chatAtoms";
import { isPreviewOpenAtom } from "@/atoms/viewAtoms";
import { parseFullMessage, type Block } from "@/lib/streamingMessageParser";
import {
  parseSubagentEvents,
  type SubagentMetaEvent,
  type SubagentOutputEvent,
  type SubagentStepEvent,
} from "@/shared/subagent_types";

export type SubagentRunStatus = "running" | "completed" | "aborted" | "error";

/**
 * A sub-agent run, derived from `<dyad-subagent>` blocks in the current
 * chat's messages (committed content) merged with the live streaming-preview
 * overlay. Runs are never duplicated in state — this is a pure projection.
 */
export interface SubagentRun {
  /** Stable id from the run's `run-id` attribute (synthetic when absent). */
  key: string;
  runId: string | null;
  type: string;
  title: string;
  appName: string | null;
  status: SubagentRunStatus;
  steps: SubagentStepEvent[];
  output: SubagentOutputEvent | null;
  meta: SubagentMetaEvent | null;
  /** Message the run is committed in; null while it only exists in the overlay. */
  messageId: number | null;
}

/** Run selected in the Agents panel (null = auto-select the latest run). */
export const selectedSubagentRunKeyAtom = atom<string | null>(null);

function runFromBlock(
  block: Block,
  {
    messageId,
    isLastMessage,
    isStreaming,
  }: { messageId: number | null; isLastMessage: boolean; isStreaming: boolean },
): SubagentRun | null {
  if (block.kind !== "custom-tag" || block.tag !== "dyad-subagent") {
    return null;
  }
  const attributes = block.attributes;
  const runId = attributes["run-id"] || null;
  const parsed = parseSubagentEvents(block.content);

  let status: SubagentRunStatus;
  if (attributes.status === "error") {
    status = "error";
  } else if (block.complete) {
    status = "completed";
  } else {
    // Unclosed tag: live while this turn still streams, aborted otherwise.
    status = isLastMessage && isStreaming ? "running" : "aborted";
  }

  return {
    key: runId ?? `msg-${messageId ?? "overlay"}-block-${block.id}`,
    runId,
    type: attributes.type || "unknown",
    title: attributes.title || parsed.meta?.title || "",
    appName: attributes["app-name"] || null,
    status,
    steps: parsed.steps,
    output: parsed.output,
    meta: parsed.meta,
    messageId,
  };
}

/**
 * All sub-agent runs in the selected chat, live runs first, then newest
 * committed runs first. Derived (and cached by jotai) from the chat's
 * messages + the streaming preview overlay.
 */
export const subagentRunsAtom = atom<SubagentRun[]>((get) => {
  const chatId = get(selectedChatIdAtom);
  if (chatId == null) return [];
  const messages = get(chatMessagesByIdAtom).get(chatId) ?? [];
  const isStreaming = get(isStreamingByIdAtom).get(chatId) ?? false;
  const previewXml = get(streamingPreviewByChatIdAtom).get(chatId);

  const runsByKey = new Map<string, SubagentRun>();

  const lastAssistantId = [...messages]
    .reverse()
    .find((message) => message.role === "assistant")?.id;

  for (const message of messages) {
    if (
      message.role !== "assistant" ||
      !message.content.includes("<dyad-subagent")
    ) {
      continue;
    }
    for (const block of parseFullMessage(message.content).blocks) {
      const run = runFromBlock(block, {
        messageId: message.id,
        isLastMessage: message.id === lastAssistantId,
        isStreaming,
      });
      if (run) {
        runsByKey.set(run.key, run);
      }
    }
  }

  // The overlay carries the in-flight run (onXmlStream) before it is
  // committed via onXmlComplete. A committed run with the same run-id wins.
  if (previewXml && previewXml.includes("<dyad-subagent")) {
    for (const block of parseFullMessage(previewXml).blocks) {
      const run = runFromBlock(block, {
        messageId: null,
        isLastMessage: true,
        isStreaming,
      });
      if (run && !runsByKey.has(run.key)) {
        runsByKey.set(run.key, run);
      }
    }
  }

  const runs = [...runsByKey.values()].reverse();
  return [
    ...runs.filter((run) => run.status === "running"),
    ...runs.filter((run) => run.status !== "running"),
  ];
});

export const hasLiveSubagentRunAtom = atom<boolean>((get) =>
  get(subagentRunsAtom).some((run) => run.status === "running"),
);

/**
 * Runs belonging to the in-flight turn, for the chips strip above the chat
 * input. Empty when the chat is not streaming — completed chips linger only
 * until the turn ends.
 */
export const currentTurnSubagentRunsAtom = atom<SubagentRun[]>((get) => {
  const chatId = get(selectedChatIdAtom);
  if (chatId == null) return [];
  const isStreaming = get(isStreamingByIdAtom).get(chatId) ?? false;
  if (!isStreaming) return [];
  const messages = get(chatMessagesByIdAtom).get(chatId) ?? [];
  const lastAssistantId = [...messages]
    .reverse()
    .find((message) => message.role === "assistant")?.id;
  return get(subagentRunsAtom).filter(
    (run) => run.messageId === null || run.messageId === lastAssistantId,
  );
});

/**
 * Open the right-side Agents panel, optionally deep-linked to a run.
 * Passing undefined/null selects the latest run.
 */
export const openSubagentPanelAtom = atom(
  null,
  (_get, set, runKey?: string | null) => {
    set(selectedSubagentRunKeyAtom, runKey ?? null);
    set(previewModeAtom, "agents");
    set(isPreviewOpenAtom, true);
  },
);
