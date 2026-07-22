/**
 * Explicitly constructed main-side owner for all user-input round trips.
 *
 * API deviation from the Phase 3 sketch: `classifierDecided` and
 * `followUpDispatched` are public because the first is the correlated MCP
 * classifier port and the second is the acknowledgement leg already named by
 * the state-machine event enumeration. `request` also accepts an optional
 * requestId solely to preserve/test duplicate-correlation supersession.
 */
import { DyadError, DyadErrorKind } from "../errors/dyad_error";
import type { Clock, ClockHandle, IdSource } from "../state_machines/clock";
import { createTraceObserver } from "../state_machines/trace";
import {
  observeTransition,
  type TransitionObserver,
} from "../state_machines/types";
import {
  createUserInputCommandRunner,
  type UserInputCommand,
  type UserInputCommandRunner,
} from "./commands";
import {
  isLiveUserInputState,
  type NewUserInputDescriptor,
  type UserInputDescriptor,
  type UserInputEvent,
  type UserInputParkValue,
  type UserInputResponse,
  type UserInputState,
} from "./state";
import { transition, type UserInputIgnoreReason } from "./transition";

const CONSENT_DEADLINE_MS = 5 * 60 * 1_000;
const INTEGRATION_DEADLINE_MS = 30 * 60 * 1_000;
const MAX_SETTLED_TOMBSTONES = 1_000;

export interface PendingUserInputSnapshot {
  status: "awaiting" | "armed" | "due";
  descriptor: UserInputDescriptor;
  deadlineAt: number;
  classifier?: "none" | "racing" | "review";
  followUpPrompt?: string;
}

interface ParkEntry {
  promise: Promise<UserInputParkValue | null>;
  resolve: (value: UserInputParkValue | null) => void;
  settled: boolean;
  claimed: boolean;
  value?: UserInputParkValue | null;
  abortCleanup?: () => void;
}

export interface UserInputRegistry {
  request(descriptor: NewUserInputDescriptor, requestId?: string): string;
  park(
    requestId: string,
    abortSignal?: AbortSignal,
  ): Promise<UserInputParkValue | null>;
  respond(requestId: string, response: UserInputResponse): Promise<void>;
  classifierDecided(
    requestId: string,
    approved: boolean,
    reason?: string,
  ): Promise<boolean>;
  sweepChat(chatId: number): void;
  streamFinished(chatId: number): void;
  followUpDispatched(requestId: string): Promise<void>;
  getPending(): PendingUserInputSnapshot[];
  dispose(): void;
}

export function createUserInputRegistry(deps: {
  clock: Clock;
  idSource: IdSource;
  broadcast: (channel: string, payload: unknown) => void;
  persistAlways?: (
    descriptor: UserInputDescriptor,
    response: UserInputResponse,
  ) => void | Promise<void>;
  commandRunner?: UserInputCommandRunner;
  observer?: TransitionObserver<
    UserInputState,
    UserInputEvent,
    UserInputCommand,
    UserInputIgnoreReason
  >;
  onCommandError?: (command: UserInputCommand, error: unknown) => void;
}): UserInputRegistry {
  const states = new Map<string, UserInputState>();
  const parks = new Map<string, ParkEntry>();
  const deadlines = new Map<string, ClockHandle>();
  const chatIndex = new Map<number, Set<string>>();
  const settledOrder: string[] = [];
  const observer = deps.observer ?? createTraceObserver("user_input");
  const effects = createUserInputCommandRunner({
    broadcast: deps.broadcast,
    persistAlways: deps.persistAlways ?? (() => undefined),
  });

  function deadlineMs(kind: UserInputDescriptor["kind"]): number {
    return kind === "integration"
      ? INTEGRATION_DEADLINE_MS
      : CONSENT_DEADLINE_MS;
  }

  function addToChat(descriptor: UserInputDescriptor): void {
    let requests = chatIndex.get(descriptor.chatId);
    if (!requests) {
      requests = new Set();
      chatIndex.set(descriptor.chatId, requests);
    }
    requests.add(descriptor.requestId);
  }

  function removeFromChat(descriptor: UserInputDescriptor): void {
    const requests = chatIndex.get(descriptor.chatId);
    requests?.delete(descriptor.requestId);
    if (requests?.size === 0) chatIndex.delete(descriptor.chatId);
  }

  function resolvePark(
    requestId: string,
    value: UserInputParkValue | null,
  ): void {
    const entry = parks.get(requestId);
    if (!entry || entry.settled) return;
    entry.settled = true;
    entry.value = value;
    entry.abortCleanup?.();
    entry.resolve(value);
    if (entry.claimed) parks.delete(requestId);
  }

  function cancelDeadline(requestId: string): void {
    const handle = deadlines.get(requestId);
    if (handle === undefined) return;
    deadlines.delete(requestId);
    deps.clock.cancel(handle);
  }

  function execute(command: UserInputCommand): void | Promise<void> {
    switch (command.type) {
      case "resolve-park":
        resolvePark(command.requestId, command.value);
        break;
      case "schedule-deadline": {
        cancelDeadline(command.requestId);
        const handle = deps.clock.schedule(() => {
          deadlines.delete(command.requestId);
          void dispatch(command.requestId, {
            type: "timed-out",
            requestId: command.requestId,
          });
        }, command.ms);
        deadlines.set(command.requestId, handle);
        break;
      }
      case "cancel-deadline":
        cancelDeadline(command.requestId);
        break;
      case "broadcast-requested":
      case "broadcast-classified":
      case "broadcast-settled":
      case "broadcast-follow-up-due":
      case "persist-always":
        break;
      default: {
        const exhaustive: never = command;
        return exhaustive;
      }
    }
    const effect = effects.run(command);
    void Promise.resolve(deps.commandRunner?.run(command)).catch((error) =>
      deps.onCommandError?.(command, error),
    );
    if (effect instanceof Promise) return effect;
  }

  function dispatch(
    requestId: string,
    event: UserInputEvent,
  ): Promise<boolean> {
    const previous = states.get(requestId) ?? ({ status: "idle" } as const);
    const result = transition(previous, event);
    observeTransition(observer, previous, event, result);
    if (result.ignoredReason !== undefined) return Promise.resolve(false);

    states.set(requestId, result.state);
    if (isLiveUserInputState(result.state)) addToChat(result.state.descriptor);
    else if (isLiveUserInputState(previous))
      removeFromChat(previous.descriptor);

    if (result.state.status === "settled") {
      settledOrder.push(requestId);
      while (settledOrder.length > MAX_SETTLED_TOMBSTONES) {
        const expiredRequestId = settledOrder.shift();
        if (expiredRequestId === undefined) break;
        if (states.get(expiredRequestId)?.status === "settled") {
          states.delete(expiredRequestId);
          parks.delete(expiredRequestId);
        }
      }
    }

    let pending: Promise<void> | undefined;
    let firstError: unknown;
    let persistenceFailed = false;
    const runCommand = (command: UserInputCommand): void | Promise<void> => {
      const effectiveCommand =
        persistenceFailed && command.type === "resolve-park"
          ? ({ ...command, value: null } as UserInputCommand)
          : command;
      try {
        const commandResult = execute(effectiveCommand);
        if (commandResult instanceof Promise) {
          return commandResult.catch((error) => {
            firstError ??= error;
            persistenceFailed ||= command.type === "persist-always";
            deps.onCommandError?.(command, error);
          });
        }
      } catch (error) {
        firstError ??= error;
        persistenceFailed ||= command.type === "persist-always";
        deps.onCommandError?.(command, error);
      }
    };
    for (const command of result.commands) {
      if (pending) {
        pending = pending.then(() => runCommand(command));
        continue;
      }
      const commandResult = runCommand(command);
      if (commandResult instanceof Promise) pending = commandResult;
    }
    const finish = () => {
      if (firstError !== undefined) throw firstError;
      return true;
    };
    return pending ? pending.then(finish) : Promise.resolve(finish());
  }

  function dispatchWithoutWaiting(
    requestId: string,
    event: UserInputEvent,
  ): void {
    void dispatch(requestId, event).catch(() => {
      // Command runner failures are programming errors, but must not wedge the
      // registry. Production runners log at their own adapter boundary.
    });
  }

  return {
    request(input, explicitRequestId) {
      const requestId = explicitRequestId ?? deps.idSource.next(input.kind);
      const ms = deadlineMs(input.kind);
      const descriptor = {
        ...input,
        requestId,
        deadlineAt: deps.clock.now() + ms,
      } as UserInputDescriptor;

      const previous = states.get(requestId);
      const superseding = previous ? isLiveUserInputState(previous) : false;
      if (!parks.has(requestId) || parks.get(requestId)?.settled) {
        let resolve!: (value: UserInputParkValue | null) => void;
        const promise = new Promise<UserInputParkValue | null>((done) => {
          resolve = done;
        });
        parks.set(requestId, {
          promise,
          resolve,
          settled: false,
          claimed: false,
        });
      }
      dispatchWithoutWaiting(requestId, {
        type: "requested",
        descriptor,
        deadlineMs: ms,
      });
      if (superseding) {
        let resolve!: (value: UserInputParkValue | null) => void;
        const promise = new Promise<UserInputParkValue | null>((done) => {
          resolve = done;
        });
        parks.set(requestId, {
          promise,
          resolve,
          settled: false,
          claimed: false,
        });
      }
      return requestId;
    },

    park(requestId, abortSignal) {
      const entry = parks.get(requestId);
      if (!entry) return Promise.resolve(null);
      entry.claimed = true;
      if (entry.settled) {
        parks.delete(requestId);
        return Promise.resolve(entry.value ?? null);
      }
      if (abortSignal?.aborted) {
        const state = states.get(requestId);
        if (state && isLiveUserInputState(state)) {
          dispatchWithoutWaiting(requestId, {
            type: "chat-swept",
            chatId: state.descriptor.chatId,
          });
        }
        return Promise.resolve(null);
      }
      if (!entry.settled && abortSignal) {
        const onAbort = () => {
          const state = states.get(requestId);
          if (state && isLiveUserInputState(state)) {
            dispatchWithoutWaiting(requestId, {
              type: "chat-swept",
              chatId: state.descriptor.chatId,
            });
          }
        };
        abortSignal.addEventListener("abort", onAbort, { once: true });
        entry.abortCleanup = () =>
          abortSignal.removeEventListener("abort", onAbort);
      }
      return entry.promise;
    },

    async respond(requestId, response) {
      const applied = await dispatch(requestId, {
        type: "human-decided",
        requestId,
        response,
      });
      if (!applied) {
        throw new DyadError(
          `No pending user-input request: ${requestId}`,
          DyadErrorKind.NotFound,
        );
      }
    },

    classifierDecided(requestId, approved, reason) {
      return dispatch(requestId, {
        type: "classifier-decided",
        requestId,
        approved,
        reason,
      });
    },

    sweepChat(chatId) {
      for (const requestId of chatIndex.get(chatId) ?? []) {
        dispatchWithoutWaiting(requestId, { type: "chat-swept", chatId });
      }
    },

    streamFinished(chatId) {
      for (const requestId of chatIndex.get(chatId) ?? []) {
        dispatchWithoutWaiting(requestId, { type: "stream-finished", chatId });
      }
    },

    async followUpDispatched(requestId) {
      const applied = await dispatch(requestId, {
        type: "follow-up-dispatched",
        requestId,
      });
      if (!applied) {
        throw new DyadError(
          `No due user-input request: ${requestId}`,
          DyadErrorKind.NotFound,
        );
      }
    },

    getPending() {
      const result: PendingUserInputSnapshot[] = [];
      for (const state of states.values()) {
        if (!isLiveUserInputState(state)) continue;
        result.push({
          status: state.status,
          descriptor: state.descriptor,
          deadlineAt: state.descriptor.deadlineAt,
          classifier:
            state.status === "awaiting" ? state.classifier : undefined,
          followUpPrompt:
            state.status === "armed" || state.status === "due"
              ? state.followUpPrompt
              : undefined,
        });
      }
      return result;
    },

    dispose() {
      for (const requestIds of chatIndex.values()) {
        for (const requestId of requestIds) {
          const state = states.get(requestId);
          if (state && state.status !== "idle" && state.status !== "settled") {
            dispatchWithoutWaiting(requestId, {
              type: "chat-swept",
              chatId: state.descriptor.chatId,
            });
          }
        }
      }
      for (const requestId of deadlines.keys()) cancelDeadline(requestId);
      states.clear();
      parks.clear();
      chatIndex.clear();
      settledOrder.length = 0;
    },
  };
}
