import { z } from "zod";

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
      return ipcRenderer.invoke(contract.channel, input);
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

  const streams = new Map<
    KeyValue,
    {
      onChunk: (data: z.infer<TChunk>) => void;
      onEnd: (data: z.infer<TEnd>) => void;
      onError: (data: z.infer<TError>) => void;
    }
  >();

  let listenersSetUp = false;

  const setupListeners = () => {
    if (listenersSetUp) return;

    const ipcRenderer = getIpcRenderer();
    if (!ipcRenderer) return;

    ipcRenderer.on(contract.events.chunk.channel, (data: unknown) => {
      const parsed = contract.events.chunk.payload.safeParse(data);
      if (parsed.success) {
        const key = (parsed.data as Record<string, unknown>)[
          contract.keyField
        ] as KeyValue;
        streams.get(key)?.onChunk(parsed.data);
      }
    });

    ipcRenderer.on(contract.events.end.channel, (data: unknown) => {
      const parsed = contract.events.end.payload.safeParse(data);
      if (parsed.success) {
        const key = (parsed.data as Record<string, unknown>)[
          contract.keyField
        ] as KeyValue;
        streams.get(key)?.onEnd(parsed.data);
        streams.delete(key);
      }
    });

    ipcRenderer.on(contract.events.error.channel, (data: unknown) => {
      const parsed = contract.events.error.payload.safeParse(data);
      if (parsed.success) {
        const key = (parsed.data as Record<string, unknown>)[
          contract.keyField
        ] as KeyValue;
        streams.get(key)?.onError(parsed.data);
        streams.delete(key);
      }
    });

    listenersSetUp = true;
  };

  return {
    /**
     * Start a stream with the given input and callbacks.
     */
    start(
      input: Input,
      callbacks: {
        onChunk: (data: z.infer<TChunk>) => void;
        onEnd: (data: z.infer<TEnd>) => void;
        onError: (data: z.infer<TError>) => void;
      },
    ): void {
      setupListeners();

      const ipcRenderer = getIpcRenderer();
      if (!ipcRenderer) {
        callbacks.onError({
          [contract.keyField]: (input as Record<string, unknown>)[
            contract.keyField
          ],
          error: "IPC renderer not available",
        } as any);
        return;
      }

      const key = (input as Record<string, unknown>)[
        contract.keyField
      ] as KeyValue;
      streams.set(key, callbacks);

      ipcRenderer.invoke(contract.channel, input).catch((err: Error) => {
        callbacks.onError({
          [contract.keyField]: key,
          error: err.message,
        } as any);
        streams.delete(key);
      });
    },

    /**
     * Cancel a stream by its key value.
     */
    cancel(key: KeyValue): void {
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
