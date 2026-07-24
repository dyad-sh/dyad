import type { IgnoreReason, TransitionObserver } from "./types";

export interface ReplayTraceEntry<SerializedEvent> {
  readonly event: SerializedEvent;
  readonly outcome:
    | {
        readonly kind: "ignored";
        readonly reason: IgnoreReason;
        stateKey: string;
      }
    | {
        readonly kind: "applied";
        readonly stateKey: string;
        readonly commands: readonly unknown[];
      };
}

export interface ReplayTrace<SerializedEvent> {
  readonly schemaVersion: number;
  readonly entries: readonly ReplayTraceEntry<SerializedEvent>[];
}

export interface MachineTraceEntry {
  readonly at: number;
  /** Monotonic process-local ordering for entries with the same timestamp. */
  readonly sequence: number;
  readonly machine: string;
  readonly key?: string | number;
  readonly from: unknown;
  readonly event: unknown;
  readonly to: unknown;
  readonly commands: readonly unknown[];
  readonly ignoredReason?: IgnoreReason;
}

export interface TraceObserverOptions<State, Event, Command> {
  /** Maximum entries retained for this machine/entity key. Defaults to 100. */
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
const MAX_TOTAL_ENTRIES = 10_000;
type TraceKey = string | number | undefined;
const logs = new Map<string, Map<TraceKey, MachineTraceEntry[]>>();
const machineIndex: string[] = [];
let nextSequence = 0;
let totalEntries = 0;

function defaultDescription(value: unknown): unknown {
  if (typeof value !== "object" || value === null) return value;
  if ("type" in value && typeof value.type === "string") return value.type;
  if ("status" in value && typeof value.status === "string") {
    return value.status;
  }
  return "[redacted untagged object]";
}

function ensureMachine(machine: string): Map<TraceKey, MachineTraceEntry[]> {
  const existing = logs.get(machine);
  if (existing) return existing;
  const rings = new Map<TraceKey, MachineTraceEntry[]>();
  logs.set(machine, rings);
  machineIndex.push(machine);
  return rings;
}

function compareEntries(
  left: MachineTraceEntry,
  right: MachineTraceEntry,
): number {
  return left.at - right.at || left.sequence - right.sequence;
}

function evictOldestEntry(): void {
  let oldest:
    | {
        entries: MachineTraceEntry[];
        entry: MachineTraceEntry;
      }
    | undefined;
  for (const rings of logs.values()) {
    for (const entries of rings.values()) {
      const entry = entries[0];
      if (
        entry !== undefined &&
        (oldest === undefined || compareEntries(entry, oldest.entry) < 0)
      ) {
        oldest = { entries, entry };
      }
    }
  }
  if (oldest !== undefined) {
    oldest.entries.shift();
    totalEntries -= 1;
  }
}

function record(entry: MachineTraceEntry, maxEntries: number): void {
  if (maxEntries === 0) return;
  const rings = ensureMachine(entry.machine);
  let entries = rings.get(entry.key);
  if (!entries) {
    entries = [];
    rings.set(entry.key, entries);
  }
  entries.push(entry);
  totalEntries += 1;
  if (entries.length > maxEntries) {
    const removed = entries.length - maxEntries;
    entries.splice(0, removed);
    totalEntries -= removed;
  }
  while (totalEntries > MAX_TOTAL_ENTRIES) {
    evictOldestEntry();
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
  if (machine !== undefined) {
    return [...(logs.get(machine)?.values() ?? [])].flat().sort(compareEntries);
  }
  return [...logs.values()]
    .flatMap((rings) => [...rings.values()].flat())
    .sort(compareEntries);
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
          sequence: nextSequence++,
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
          sequence: nextSequence++,
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

export interface ReplaySerialization<State, Event, Command, SerializedEvent> {
  readonly schemaVersion: number;
  serializeEvent(event: Event): SerializedEvent;
  deserializeEvent(event: SerializedEvent): Event;
  stateKey(state: State): string;
  describeCommand(command: Command): unknown;
}

/**
 * Creates an explicitly opt-in replay-grade recorder for development and
 * tests. Unlike debug traces, entries retain complete domain-serialized
 * events and are not exposed through production devtools.
 */
export function createReplayTraceObserver<
  State,
  Event,
  Command,
  SerializedEvent,
  Reason extends IgnoreReason = IgnoreReason,
>(
  serialization: ReplaySerialization<State, Event, Command, SerializedEvent>,
): {
  observer: TransitionObserver<State, Event, Command, Reason>;
  getTrace(): ReplayTrace<SerializedEvent>;
} {
  const entries: ReplayTraceEntry<SerializedEvent>[] = [];
  return {
    observer: {
      onTransitionApplied: ({ event, state, commands }) => {
        entries.push({
          event: serialization.serializeEvent(event),
          outcome: {
            kind: "applied",
            stateKey: serialization.stateKey(state),
            commands: commands.map((command) =>
              serialization.describeCommand(command),
            ),
          },
        });
      },
      onEventIgnored: ({ state, event, reason }) => {
        entries.push({
          event: serialization.serializeEvent(event),
          outcome: {
            kind: "ignored",
            reason,
            stateKey: serialization.stateKey(state),
          },
        });
      },
    },
    getTrace: () => ({
      schemaVersion: serialization.schemaVersion,
      entries: [...entries],
    }),
  };
}

declare global {
  interface Window {
    __dyadMachines?: MachineTraceDevtools;
  }
}

const isDebugBuild = process.env.NODE_ENV !== "production";

if (typeof window !== "undefined" && isDebugBuild) {
  window.__dyadMachines = {
    get index() {
      return [...machineIndex];
    },
    dump: getTraceLog,
  };
}
