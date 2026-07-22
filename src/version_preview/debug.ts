/**
 * Dev-only observability for the version preview machine: a small ring
 * buffer of transitions, exposed as window.__dyadVersionPreviewLog. Any
 * captured trace replays deterministically through transition() in a test.
 */

import type { PreviewCommand, PreviewEvent, PreviewState } from "./state";
import type { IgnoreReason, TransitionObserver } from "@/state_machines/types";

export interface VersionPreviewDebugEntry {
  at: number;
  appId: number;
  from: PreviewState["type"];
  event: PreviewEvent["type"];
  to: PreviewState["type"];
  commands: PreviewCommand["type"][];
  ignoredReason?: IgnoreReason;
}

const MAX_ENTRIES = 100;
const entries: VersionPreviewDebugEntry[] = [];

export function recordVersionPreviewTransition(entry: {
  appId: number;
  from: PreviewState;
  event: PreviewEvent;
  to: PreviewState;
  commands: PreviewCommand[];
  ignoredReason?: IgnoreReason;
}): void {
  entries.push({
    at: Date.now(),
    appId: entry.appId,
    from: entry.from.type,
    event: entry.event.type,
    to: entry.to.type,
    commands: entry.commands.map((command) => command.type),
    ignoredReason: entry.ignoredReason,
  });
  if (entries.length > MAX_ENTRIES) {
    entries.splice(0, entries.length - MAX_ENTRIES);
  }
}

export function createVersionPreviewTransitionObserver(
  appId: number,
): TransitionObserver<PreviewState, PreviewEvent, PreviewCommand> {
  return {
    onTransitionApplied: ({ previous, event, state, commands }) =>
      recordVersionPreviewTransition({
        appId,
        from: previous,
        event,
        to: state,
        commands: [...commands],
      }),
    onEventIgnored: ({ state, event, reason }) =>
      recordVersionPreviewTransition({
        appId,
        from: state,
        event,
        to: state,
        commands: [],
        ignoredReason: reason,
      }),
  };
}

export function getVersionPreviewDebugLog(): readonly VersionPreviewDebugEntry[] {
  return entries;
}

declare global {
  interface Window {
    __dyadVersionPreviewLog?: readonly VersionPreviewDebugEntry[];
  }
}

if (typeof window !== "undefined") {
  window.__dyadVersionPreviewLog = entries;
}
