import type { IgnoreReason, TransitionObserver } from "./types";

export interface MachineTraceEntry {
  readonly at: number;
  readonly machine: string;
  readonly key?: string | number;
  readonly from: unknown;
  readonly event: unknown;
  readonly to: unknown;
  readonly commands: readonly unknown[];
  readonly ignoredReason?: IgnoreReason;
}

export interface TraceObserverOptions<State, Event, Command> {
  /** Maximum entries retained for this machine. Defaults to 100. */
  maxEntries?: number;
  describeState?: (state: State) => unknown;
  describeEvent?: (event: Event) => unknown;
  describeCommand?: (command: Command) => unknown;
  /** Return true for noisy events that should not be recorded. */
  mute?: (event: Event) => boolean;
}

export interface MachineTraceDevtools {
  /** Machine names that have registered a trace observer. */
  readonly index: readonly string[];
  dump(machine?: string): readonly MachineTraceEntry[];
}

const DEFAULT_MAX_ENTRIES = 100;
const logs = new Map<string, MachineTraceEntry[]>();
const machineIndex: string[] = [];

function defaultDescription(value: unknown): unknown {
  if (typeof value !== "object" || value === null) return value;
  if ("type" in value && typeof value.type === "string") return value.type;
  if ("status" in value && typeof value.status === "string") {
    return value.status;
  }
  return value;
}

function ensureMachine(machine: string): MachineTraceEntry[] {
  const existing = logs.get(machine);
  if (existing) return existing;
  const entries: MachineTraceEntry[] = [];
  logs.set(machine, entries);
  machineIndex.push(machine);
  return entries;
}

function record(entry: MachineTraceEntry, maxEntries: number): void {
  if (maxEntries === 0) return;
  const entries = ensureMachine(entry.machine);
  entries.push(entry);
  if (entries.length > maxEntries) {
    entries.splice(0, entries.length - maxEntries);
  }
}

/**
 * Return a snapshot of captured traces. Without a machine name, entries from
 * every machine are merged chronologically.
 *
 * By default, values with a string `type` or `status` discriminator are
 * recorded as that compact tag. Pass identity description functions when a
 * captured event sequence should retain enough data for deterministic replay
 * through a pure transition function.
 */
export function getTraceLog(machine?: string): readonly MachineTraceEntry[] {
  if (machine !== undefined) return [...(logs.get(machine) ?? [])];
  return [...logs.values()].flat().sort((a, b) => a.at - b.at);
}

export function createTraceObserver<
  State,
  Event,
  Command,
  Reason extends IgnoreReason = IgnoreReason,
>(
  machine: string,
  key?: string | number,
  options: TraceObserverOptions<State, Event, Command> = {},
): TransitionObserver<State, Event, Command, Reason> {
  ensureMachine(machine);
  const maxEntries = Math.max(
    0,
    Math.floor(options.maxEntries ?? DEFAULT_MAX_ENTRIES),
  );
  const describeState = options.describeState ?? defaultDescription;
  const describeEvent = options.describeEvent ?? defaultDescription;
  const describeCommand = options.describeCommand ?? defaultDescription;

  return {
    onTransitionApplied: ({ previous, event, state, commands }) => {
      if (options.mute?.(event)) return;
      record(
        {
          at: Date.now(),
          machine,
          key,
          from: describeState(previous),
          event: describeEvent(event),
          to: describeState(state),
          commands: commands.map(describeCommand),
        },
        maxEntries,
      );
    },
    onEventIgnored: ({ state, event, reason }) => {
      if (options.mute?.(event)) return;
      record(
        {
          at: Date.now(),
          machine,
          key,
          from: describeState(state),
          event: describeEvent(event),
          to: describeState(state),
          commands: [],
          ignoredReason: reason,
        },
        maxEntries,
      );
    },
  };
}

declare global {
  interface Window {
    __dyadMachines?: MachineTraceDevtools;
  }
}

if (typeof window !== "undefined") {
  window.__dyadMachines = {
    get index() {
      return [...machineIndex];
    },
    dump: getTraceLog,
  };
}
