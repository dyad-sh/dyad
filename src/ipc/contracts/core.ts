import { z } from "zod";
import { DyadError, DyadErrorKind, isDyadError } from "../../errors/dyad_error";

// =============================================================================
// Contract Type Definitions
// =============================================================================

/**
 * Standard IPC contract for invoke/response pattern.
 * Used for request-response style IPC calls.
 */
export interface IpcContract<
  TChannel extends string,
  TInput extends z.ZodType,
  TOutput extends z.ZodType,
> {
  readonly channel: TChannel;
  readonly input: TInput;
  readonly output: TOutput;
}

/**
 * Event contract for pub/sub pattern (main -> renderer).
 * Used for events pushed from main process to renderer.
 */
export interface EventContract<
  TChannel extends string,
  TPayload extends z.ZodType,
> {
  readonly channel: TChannel;
  readonly payload: TPayload;
}

/**
 * One-way IPC contract (renderer -> main), fire-and-forget with NO response.
 *
 * Unlike an invoke contract, the main process never replies. This matters for
 * messages fired while the renderer frame is being torn down (e.g. on
 * `pagehide` during app quit): a two-way `invoke` would leave the main process
 * trying to post its reply back to an already-destroyed frame, which Electron
 * surfaces as an unhandled "Object has been destroyed" error. A one-way send
 * has no reply, so there is nothing to deliver back.
 */
export interface SendContract<
  TChannel extends string,
  TInput extends z.ZodType,
> {
  readonly channel: TChannel;
  readonly input: TInput;
}

/**
 * Stream contract for invoke + multiple events pattern.
 * Used for streaming responses (e.g., chat streaming).
 */
export interface StreamContract<
  TChannel extends string,
  TInput extends z.ZodType,
  TKey extends string,
  TChunk extends z.ZodType,
  TEnd extends z.ZodType,
  TError extends z.ZodType,
> {
  readonly channel: TChannel;
  readonly input: TInput;
  readonly keyField: TKey;
  readonly events: {
    readonly chunk: { channel: string; payload: TChunk };
    readonly end: { channel: string; payload: TEnd };
    readonly error: { channel: string; payload: TError };
  };
}

// =============================================================================
// Contract Factories
// =============================================================================

/**
 * Creates a typed IPC contract definition.
 * Contract = Single Source of Truth for channel name, input schema, and output schema.
 */
export function defineContract<
  TChannel extends string,
  TInput extends z.ZodType,
  TOutput extends z.ZodType,
>(contract: {
  channel: TChannel;
  input: TInput;
  output: TOutput;
}): IpcContract<TChannel, TInput, TOutput> {
  return contract;
}

/**
 * Creates a typed event contract definition.
 * Used for main -> renderer pub/sub events.
 */
export function defineEvent<
  TChannel extends string,
  TPayload extends z.ZodType,
>(event: {
  channel: TChannel;
  payload: TPayload;
}): EventContract<TChannel, TPayload> {
  return event;
}

/**
 * Creates a typed one-way send contract definition (renderer -> main, no reply).
 */
export function defineSendContract<
  TChannel extends string,
  TInput extends z.ZodType,
>(contract: {
  channel: TChannel;
  input: TInput;
}): SendContract<TChannel, TInput> {
  return contract;
}

/**
 * Creates a typed stream contract definition.
 * Used for invoke + streaming response pattern.
 */
export function defineStream<
  TChannel extends string,
  TInput extends z.ZodType,
  TKey extends string,
  TChunk extends z.ZodType,
  TEnd extends z.ZodType,
  TError extends z.ZodType,
>(
  stream: StreamContract<TChannel, TInput, TKey, TChunk, TEnd, TError>,
): StreamContract<TChannel, TInput, TKey, TChunk, TEnd, TError> {
  return stream;
}

// =============================================================================
// Type Helpers
// =============================================================================

/** Extract the input type from a contract */
export type ContractInput<T> =
  T extends IpcContract<any, infer I, any> ? z.infer<I> : never;

/** Extract the output type from a contract */
export type ContractOutput<T> =
  T extends IpcContract<any, any, infer O> ? z.infer<O> : never;

/** Extract the channel name from a contract */
export type ContractChannel<T> =
  T extends IpcContract<infer C, any, any> ? C : never;

/** Extract the payload type from an event contract */
export type EventPayload<T> =
  T extends EventContract<any, infer P> ? z.infer<P> : never;

/** Extract the channel name from an event contract */
export type EventChannel<T> = T extends EventContract<infer C, any> ? C : never;

// =============================================================================
// Client Generators
// =============================================================================

const IPC_ENVELOPE_MARKER = "dyad-ipc-envelope-v1";

export interface SerializedIpcError {
  name?: string;
  message: string;
  kind?: DyadErrorKind;
  stack?: string;
}

export type IpcInvokeEnvelope<T = unknown> =
  | {
      __dyadIpcEnvelope: typeof IPC_ENVELOPE_MARKER;
      ok: true;
      value: T;
    }
  | {
      __dyadIpcEnvelope: typeof IPC_ENVELOPE_MARKER;
      ok: false;
      error: SerializedIpcError;
    };

export function createIpcSuccessEnvelope<T>(value: T): IpcInvokeEnvelope<T> {
  return {
    __dyadIpcEnvelope: IPC_ENVELOPE_MARKER,
    ok: true,
    value,
  };
}

export function createIpcErrorEnvelope(error: unknown): IpcInvokeEnvelope {
  return {
    __dyadIpcEnvelope: IPC_ENVELOPE_MARKER,
    ok: false,
    error: serializeIpcError(error),
  };
}

export function isIpcInvokeEnvelope(
  value: unknown,
): value is IpcInvokeEnvelope {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { __dyadIpcEnvelope?: unknown }).__dyadIpcEnvelope ===
      IPC_ENVELOPE_MARKER &&
    typeof (value as { ok?: unknown }).ok === "boolean"
  );
}

export function serializeIpcError(error: unknown): SerializedIpcError {
  if (isDyadError(error)) {
    return {
      name: error.name,
      message: error.message,
      kind: error.kind,
      stack: error.stack,
    };
  }

  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }

  return { message: String(error) };
}

function isDyadErrorKind(value: unknown): value is DyadErrorKind {
  return (
    typeof value === "string" &&
    Object.values(DyadErrorKind).includes(value as DyadErrorKind)
  );
}

export function deserializeIpcError(error: SerializedIpcError): Error {
  if (isDyadErrorKind(error.kind)) {
    const dyadError = new DyadError(error.message, error.kind);
    dyadError.stack = error.stack;
    return dyadError;
  }

  const genericError = new Error(error.message);
  genericError.name = error.name ?? genericError.name;
  genericError.stack = error.stack;
  return genericError;
}

export function unwrapIpcEnvelope<T>(response: IpcInvokeEnvelope<T>): T {
  if (response.ok) {
    return response.value;
  }
  throw deserializeIpcError(response.error);
}

/** Type to convert contracts object to client methods */
type ClientFromContracts<
  T extends Record<string, IpcContract<string, z.ZodType, z.ZodType>>,
> = {
  [K in keyof T]: (
    input: z.infer<T[K]["input"]>,
  ) => Promise<z.infer<T[K]["output"]>>;
};

/**
 * Creates a typed client from a contracts object.
 * Each contract key becomes a method name, types are derived automatically.
 *
 * @example
 * const appContracts = {
 *   createApp: defineContract({ channel: "create-app", input: ..., output: ... }),
 *   deleteApp: defineContract({ channel: "delete-app", input: ..., output: ... }),
 * };
 * const appClient = createClient(appContracts);
 * // appClient.createApp(params) - params/result types derived automatically
 */
export function createClient<
  T extends Record<string, IpcContract<string, z.ZodType, z.ZodType>>,
>(contracts: T): ClientFromContracts<T> {
  // Access ipcRenderer from the window.electron exposed by preload
  const getIpcRenderer = () => (window as any).electron?.ipcRenderer;

  const client = {} as ClientFromContracts<T>;
  for (const [methodName, contract] of Object.entries(contracts)) {
    (client as any)[methodName] = async (input: unknown) => {
      const ipcRenderer = getIpcRenderer();
      if (!ipcRenderer) {
        throw new Error(
          `[${contract.channel}] IPC renderer not available. Make sure this is called from the renderer process.`,
        );
      }
      const invoke =
        typeof ipcRenderer.invokeEnvelope === "function"
          ? ipcRenderer.invokeEnvelope
          : ipcRenderer.invoke;
      const response = await invoke(contract.channel, input);
      return isIpcInvokeEnvelope(response)
        ? unwrapIpcEnvelope(response)
        : response;
    };
  }
  return client;
}

/** Type to convert send contracts object to fire-and-forget client methods */
type SendClientFromContracts<
  T extends Record<string, SendContract<string, z.ZodType>>,
> = {
  [K in keyof T]: (input: z.infer<T[K]["input"]>) => void;
};

/**
 * Creates a typed one-way send client from a send-contracts object. Each method
 * dispatches a fire-and-forget `ipcRenderer.send` and returns immediately —
 * there is no response to await. Use for writes that must survive being fired
 * during renderer teardown (see {@link SendContract}).
 */
export function createSendClient<
  T extends Record<string, SendContract<string, z.ZodType>>,
>(contracts: T): SendClientFromContracts<T> {
  // Access ipcRenderer from the window.electron exposed by preload
  const getIpcRenderer = () => (window as any).electron?.ipcRenderer;

  const client = {} as SendClientFromContracts<T>;
  for (const [methodName, contract] of Object.entries(contracts)) {
    (client as any)[methodName] = (input: unknown) => {
      const ipcRenderer = getIpcRenderer();
      if (typeof ipcRenderer?.send !== "function") {
        throw new Error(
          `[${contract.channel}] IPC renderer send not available. Make sure this is called from the renderer process.`,
        );
      }
      ipcRenderer.send(contract.channel, input);
    };
  }
  return client;
}

// =============================================================================
// Event Client Generator
// =============================================================================

/** Capitalize first letter of a string type */
type Capitalize<S extends string> = S extends `${infer F}${infer R}`
  ? `${Uppercase<F>}${R}`
  : S;

/** Type to convert event contracts object to event client methods */
type EventClientFromContracts<
  T extends Record<string, EventContract<string, z.ZodType>>,
> = {
  [K in keyof T as `on${Capitalize<string & K>}`]: (
    handler: (payload: z.infer<T[K]["payload"]>) => void,
  ) => () => void; // Returns unsubscribe function
};

/**
 * Creates a typed event client from an events object.
 * Each event key becomes an on<Key> method, types are derived automatically.
 *
 * @example
 * const agentEvents = {
 *   todosUpdate: defineEvent({ channel: "agent-tool:todos-update", payload: ... }),
 * };
 * const agentEventClient = createEventClient(agentEvents);
 * // agentEventClient.onTodosUpdate(handler) -> unsubscribe fn
 */
export function createEventClient<
  T extends Record<string, EventContract<string, z.ZodType>>,
>(events: T): EventClientFromContracts<T> {
  const getIpcRenderer = () => (window as any).electron?.ipcRenderer;

  const client = {} as EventClientFromContracts<T>;

  for (const [key, event] of Object.entries(events)) {
    const methodName = `on${key.charAt(0).toUpperCase()}${key.slice(1)}`;
    (client as any)[methodName] = (handler: (payload: unknown) => void) => {
      const ipcRenderer = getIpcRenderer();
      if (!ipcRenderer) {
        console.error(
          `[${event.channel}] IPC renderer not available. Make sure this is called from the renderer process.`,
        );
        return () => {};
      }

      const listener = (data: unknown) => {
        const parsed = event.payload.safeParse(data);
        if (parsed.success) {
          handler(parsed.data);
        } else {
          console.error(
            `[${event.channel}] Invalid payload:`,
            parsed.error.format(),
          );
        }
      };

      const unsubscribe = ipcRenderer.on(event.channel, listener);
      return unsubscribe;
    };
  }

  return client;
}

// =============================================================================
// Stream Client Generator
// =============================================================================

/**
 * Creates a typed stream client from a stream contract.
 * Manages callbacks internally and routes events by key field.
 *
 * @example
 * const chatStreamContract = defineStream({
 *   channel: "chat:stream",
 *   input: ChatStreamParamsSchema,
 *   keyField: "chatId",
 *   events: { chunk: ..., end: ..., error: ... },
 * });
 * const chatStreamClient = createStreamClient(chatStreamContract);
 * chatStreamClient.start({ chatId: 123, prompt: "Hello" }, { onChunk, onEnd, onError });
 */
export function createStreamClient<
  TChannel extends string,
  TInput extends z.ZodType,
  TKey extends string,
  TChunk extends z.ZodType,
  TEnd extends z.ZodType,
  TError extends z.ZodType,
>(contract: StreamContract<TChannel, TInput, TKey, TChunk, TEnd, TError>) {
  const getIpcRenderer = () => (window as any).electron?.ipcRenderer;

  type Input = z.infer<TInput>;
  // Use string | number for KeyValue to support common key types while
  // maintaining better type safety than unknown. TypeScript cannot infer
  // the exact key type from TInput[TKey] due to Zod v4 type system limitations.
  type KeyValue = string | number;

  interface StreamEntry {
    callbacks: {
      onChunk: (data: z.infer<TChunk>) => void;
      onEnd: (data: z.infer<TEnd>) => void;
      onError: (data: z.infer<TError>) => void;
    };
    /** Monotonic per-client stream generation; identifies this start() call. */
    streamId: number;
    /** When true (default), the entry is removed on end/error events. */
    autoRelease: boolean;
  }

  const streams = new Map<KeyValue, StreamEntry>();

  // Monotonic generation counter: every start() gets a fresh streamId. Stream
  // contracts that echo it in their payloads reject stale chunk/end/error
  // events even after a same-key entry has been replaced. Payloads without a
  // streamId retain the legacy key-only routing behavior.
  let nextStreamId = 0;

  let listenersSetUp = false;

  const setupListeners = () => {
    if (listenersSetUp) return;

    const ipcRenderer = getIpcRenderer();
    if (!ipcRenderer) return;

    ipcRenderer.on(contract.events.chunk.channel, (data: unknown) => {
      const parsed = contract.events.chunk.payload.safeParse(data);
      if (parsed.success) {
        const payload = parsed.data as Record<string, unknown>;
        const key = payload[contract.keyField] as KeyValue;
        const entry = streams.get(key);
        if (!entry) return;
        if (
          typeof payload.streamId === "number" &&
          payload.streamId !== entry.streamId
        ) {
          return;
        }
        entry.callbacks.onChunk(parsed.data);
      }
    });

    ipcRenderer.on(contract.events.end.channel, (data: unknown) => {
      const parsed = contract.events.end.payload.safeParse(data);
      if (parsed.success) {
        const payload = parsed.data as Record<string, unknown>;
        const key = payload[contract.keyField] as KeyValue;
        const entry = streams.get(key);
        if (!entry) return;
        if (
          typeof payload.streamId === "number" &&
          payload.streamId !== entry.streamId
        ) {
          return;
        }
        entry.callbacks.onEnd(parsed.data);
        // The terminal callback may synchronously start another stream with
        // the same key. Only clean up the generation that actually ended.
        if (entry.autoRelease && streams.get(key) === entry) {
          streams.delete(key);
        }
      }
    });

    ipcRenderer.on(contract.events.error.channel, (data: unknown) => {
      const parsed = contract.events.error.payload.safeParse(data);
      if (parsed.success) {
        const payload = parsed.data as Record<string, unknown>;
        const key = payload[contract.keyField] as KeyValue;
        const entry = streams.get(key);
        if (!entry) return;
        if (
          typeof payload.streamId === "number" &&
          payload.streamId !== entry.streamId
        ) {
          return;
        }
        entry.callbacks.onError(parsed.data);
        // The error callback may synchronously replace this stream.
        if (entry.autoRelease && streams.get(key) === entry) {
          streams.delete(key);
        }
      }
    });

    listenersSetUp = true;
  };

  return {
    /**
     * Start a stream with the given input and callbacks.
     *
     * Returns the monotonic streamId identifying this start() call. With
     * `autoRelease: false` the entry keeps receiving events after end/error
     * until `release(key, streamId)` is called (used by the chat stream
     * controller, which owns terminal reconciliation).
     */
    start(
      input: Input,
      callbacks: {
        onChunk: (data: z.infer<TChunk>) => void;
        onEnd: (data: z.infer<TEnd>) => void;
        onError: (data: z.infer<TError>) => void;
      },
      opts?: { streamId?: number; autoRelease?: boolean },
    ): number {
      setupListeners();

      const streamId = opts?.streamId ?? ++nextStreamId;
      if (streamId > nextStreamId) {
        nextStreamId = streamId;
      }

      const ipcRenderer = getIpcRenderer();
      if (!ipcRenderer) {
        callbacks.onError({
          [contract.keyField]: (input as Record<string, unknown>)[
            contract.keyField
          ],
          error: "IPC renderer not available",
        } as any);
        return streamId;
      }

      const key = (input as Record<string, unknown>)[
        contract.keyField
      ] as KeyValue;
      const entry: StreamEntry = {
        callbacks,
        streamId,
        autoRelease: opts?.autoRelease !== false,
      };
      streams.set(key, entry);

      ipcRenderer.invoke(contract.channel, input).catch((err: Error) => {
        // Only surface the failure if this start() call still owns the entry.
        if (streams.get(key) !== entry) return;
        callbacks.onError({
          [contract.keyField]: key,
          error: err.message,
        } as any);
        // The error callback may synchronously replace this stream.
        if (streams.get(key) === entry) {
          streams.delete(key);
        }
      });
      return streamId;
    },

    /**
     * Cancel a stream by its key value.
     */
    cancel(key: KeyValue): void {
      streams.delete(key);
    },

    /**
     * Release a stream entry. When `streamId` is given, only releases if the
     * current entry belongs to that generation (stale releases are no-ops).
     */
    release(key: KeyValue, streamId?: number): void {
      const entry = streams.get(key);
      if (!entry) return;
      if (streamId !== undefined && entry.streamId !== streamId) return;
      streams.delete(key);
    },

    /**
     * Check if a stream is active for a given key.
     */
    isActive(key: KeyValue): boolean {
      return streams.has(key);
    },
  };
}

// =============================================================================
// Channel Extraction Helpers
// =============================================================================

/**
 * Extract all invoke channels from a contracts object.
 * Used for building the preload whitelist.
 */
export function getInvokeChannels<
  T extends Record<string, { channel: string }>,
>(contracts: T): T[keyof T]["channel"][] {
  return Object.values(contracts).map((c) => c.channel);
}

/**
 * Extract all one-way send channels from a send-contracts object.
 * Used for building the preload whitelist.
 */
export function getSendChannels<T extends Record<string, { channel: string }>>(
  contracts: T,
): T[keyof T]["channel"][] {
  return Object.values(contracts).map((c) => c.channel);
}

/**
 * Extract all receive (event) channels from an events object.
 * Used for building the preload whitelist.
 */
export function getReceiveChannels<
  T extends Record<string, { channel: string }>,
>(events: T): T[keyof T]["channel"][] {
  return Object.values(events).map((e) => e.channel);
}

/**
 * Extract all channels from a stream contract (invoke + events).
 */
export function getStreamChannels<
  TChannel extends string,
  TInput extends z.ZodType,
  TKey extends string,
  TChunk extends z.ZodType,
  TEnd extends z.ZodType,
  TError extends z.ZodType,
>(
  stream: StreamContract<TChannel, TInput, TKey, TChunk, TEnd, TError>,
): { invoke: TChannel; receive: string[] } {
  return {
    invoke: stream.channel,
    receive: [
      stream.events.chunk.channel,
      stream.events.end.channel,
      stream.events.error.channel,
    ],
  };
}
