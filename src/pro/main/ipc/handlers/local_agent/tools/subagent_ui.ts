import { randomUUID } from "node:crypto";

import type {
  SubagentEvent,
  SubagentOutputEvent,
  SubagentStepEvent,
  SubagentType,
} from "@/shared/subagent_types";
import { escapeXmlAttr, escapeXmlContent, type AgentContext } from "./types";

const MAX_STEP_DETAIL_CHARS = 2_000;

/**
 * Shared UI emitter for sub-agent tools (Code Explorer today; future
 * sub-agents reuse this). Serializes the run as a `<dyad-subagent>` tag whose
 * body is NDJSON events (see src/shared/subagent_types.ts) and forwards it to
 * the renderer via the tool's onXmlStream/onXmlComplete lifecycle: streamed
 * (unclosed) while running, committed (closed) on completion or error.
 */
export interface SubagentUiEmitter {
  readonly runId: string;
  /** Append a step and stream the updated (unclosed) tag. */
  step(step: Omit<SubagentStepEvent, "kind">): void;
  /** Append the final output event and commit the closed tag. */
  complete(output: Omit<SubagentOutputEvent, "kind">): void;
  /** Commit the closed tag with status="error" and the message as summary. */
  error(message: string): void;
}

export function createSubagentUiEmitter({
  type,
  title,
  appName,
  ctx,
}: {
  type: SubagentType;
  title: string;
  appName?: string;
  ctx: AgentContext;
}): SubagentUiEmitter {
  const runId = `run_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const events: SubagentEvent[] = [{ kind: "meta", title }];
  let settled = false;

  const serialize = (options: { closed: boolean; status?: string }): string => {
    const attrs = [
      `type="${escapeXmlAttr(type)}"`,
      `run-id="${escapeXmlAttr(runId)}"`,
      `title="${escapeXmlAttr(title)}"`,
    ];
    if (appName) {
      attrs.push(`app-name="${escapeXmlAttr(appName)}"`);
    }
    if (options.status) {
      attrs.push(`status="${escapeXmlAttr(options.status)}"`);
    }
    const body = events
      .map((event) => escapeXmlContent(JSON.stringify(event)))
      .join("\n");
    const open = `<dyad-subagent ${attrs.join(" ")}>\n${body}\n`;
    return options.closed ? `${open}</dyad-subagent>` : open;
  };

  // Stream the meta event right away so the card renders as soon as the
  // sub-agent starts, before its first step lands.
  ctx.onXmlStream(serialize({ closed: false }));

  return {
    runId,
    step(step) {
      if (settled) return;
      events.push({
        kind: "step",
        ...step,
        detail: truncateDetail(step.detail),
      });
      ctx.onXmlStream(serialize({ closed: false }));
    },
    complete(output) {
      if (settled) return;
      settled = true;
      events.push({ kind: "output", ...output });
      ctx.onXmlComplete(serialize({ closed: true, status: "completed" }));
    },
    error(message) {
      if (settled) return;
      settled = true;
      events.push({ kind: "output", summary: message, data: null });
      ctx.onXmlComplete(serialize({ closed: true, status: "error" }));
    },
  };
}

function truncateDetail(detail: string | undefined): string | undefined {
  if (!detail) return undefined;
  if (detail.length <= MAX_STEP_DETAIL_CHARS) return detail;
  return `${detail.slice(0, MAX_STEP_DETAIL_CHARS)}\n… [truncated]`;
}
