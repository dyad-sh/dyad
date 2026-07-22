import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import {
  createClient,
  createIpcErrorEnvelope,
  createIpcSuccessEnvelope,
  createStreamClient,
  defineContract,
  defineStream,
  deserializeIpcError,
  serializeIpcError,
} from "./core";

function setupStreamClient() {
  const listeners = new Map<string, (data: unknown) => void>();
  const invoke = vi.fn().mockResolvedValue(undefined);
  (window as any).electron = {
    ipcRenderer: {
      invoke,
      on: vi.fn((channel: string, listener: (data: unknown) => void) => {
        listeners.set(channel, listener);
        return vi.fn();
      }),
    },
  };

  const client = createStreamClient(
    defineStream({
      channel: "test:stream",
      input: z.object({ chatId: z.number() }),
      keyField: "chatId",
      events: {
        chunk: {
          channel: "test:stream:chunk",
          payload: z.object({
            chatId: z.number(),
            streamId: z.number().optional(),
            value: z.string(),
          }),
        },
        end: {
          channel: "test:stream:end",
          payload: z.object({
            chatId: z.number(),
            streamId: z.number().optional(),
          }),
        },
        error: {
          channel: "test:stream:error",
          payload: z.object({
            chatId: z.number(),
            streamId: z.number().optional(),
            error: z.string(),
          }),
        },
      },
    }),
  );

  return { client, invoke, listeners };
}

describe("IPC invoke envelopes", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete (window as any).electron;
  });

  it("serializes and deserializes DyadError kind", () => {
    const serialized = serializeIpcError(
      new DyadError("Name already exists", DyadErrorKind.Conflict),
    );

    const deserialized = deserializeIpcError(serialized);

    expect(deserialized).toBeInstanceOf(DyadError);
    expect((deserialized as DyadError).kind).toBe(DyadErrorKind.Conflict);
    expect(deserialized.message).toBe("Name already exists");
  });

  it("preserves custom DyadError names and codes through a round trip", () => {
    const error = new DyadError(
      "A rebase is already in progress",
      DyadErrorKind.Precondition,
    ) as DyadError & { code: string };
    error.name = "GitStateError";
    error.code = "REBASE_IN_PROGRESS";

    const deserialized = deserializeIpcError(serializeIpcError(error));

    expect(deserialized).toBeInstanceOf(DyadError);
    expect(deserialized).toMatchObject({
      name: "GitStateError",
      code: "REBASE_IN_PROGRESS",
      kind: DyadErrorKind.Precondition,
      message: "A rebase is already in progress",
    });
  });

  it("deserializes plain errors without treating them as DyadError", () => {
    const deserialized = deserializeIpcError({
      name: "TypeError",
      message: "Boom",
    });

    expect(deserialized).toBeInstanceOf(Error);
    expect(deserialized).not.toBeInstanceOf(DyadError);
    expect(deserialized.name).toBe("TypeError");
    expect(deserialized.message).toBe("Boom");
  });

  it("unwraps success envelopes in generated clients", async () => {
    const invokeEnvelope = vi
      .fn()
      .mockResolvedValue(createIpcSuccessEnvelope({ value: 42 }));
    (window as any).electron = { ipcRenderer: { invokeEnvelope } };

    const client = createClient({
      answer: defineContract({
        channel: "answer",
        input: z.object({}),
        output: z.object({ value: z.number() }),
      }),
    });

    await expect(client.answer({})).resolves.toEqual({ value: 42 });
    expect(invokeEnvelope).toHaveBeenCalledWith("answer", {});
  });

  it("rethrows DyadError envelopes from generated clients", async () => {
    const invokeEnvelope = vi
      .fn()
      .mockResolvedValue(
        createIpcErrorEnvelope(
          new DyadError("No matching app", DyadErrorKind.NotFound),
        ),
      );
    (window as any).electron = { ipcRenderer: { invokeEnvelope } };

    const client = createClient({
      load: defineContract({
        channel: "load",
        input: z.object({}),
        output: z.void(),
      }),
    });

    await expect(client.load({})).rejects.toMatchObject({
      name: "DyadError",
      kind: DyadErrorKind.NotFound,
      message: "No matching app",
    });
  });

  it("accepts legacy non-envelope responses in generated clients", async () => {
    const invokeEnvelope = vi.fn().mockResolvedValue("legacy");
    (window as any).electron = { ipcRenderer: { invokeEnvelope } };

    const client = createClient({
      legacy: defineContract({
        channel: "legacy",
        input: z.object({}),
        output: z.string(),
      }),
    });

    await expect(client.legacy({})).resolves.toBe("legacy");
  });
});

describe("IPC stream callback cleanup", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete (window as any).electron;
  });

  it("preserves a same-key stream started synchronously from onEnd", () => {
    const { client, listeners } = setupStreamClient();
    const replacementOnChunk = vi.fn();

    client.start(
      { chatId: 1 },
      {
        onChunk: vi.fn(),
        onEnd: () => {
          client.start(
            { chatId: 1 },
            {
              onChunk: replacementOnChunk,
              onEnd: vi.fn(),
              onError: vi.fn(),
            },
          );
        },
        onError: vi.fn(),
      },
    );

    listeners.get("test:stream:end")?.({ chatId: 1 });
    listeners.get("test:stream:chunk")?.({ chatId: 1, value: "next" });

    expect(replacementOnChunk).toHaveBeenCalledWith({
      chatId: 1,
      value: "next",
    });
  });

  it("preserves a same-key stream started synchronously from onError", () => {
    const { client, listeners } = setupStreamClient();
    const replacementOnChunk = vi.fn();

    client.start(
      { chatId: 1 },
      {
        onChunk: vi.fn(),
        onEnd: vi.fn(),
        onError: () => {
          client.start(
            { chatId: 1 },
            {
              onChunk: replacementOnChunk,
              onEnd: vi.fn(),
              onError: vi.fn(),
            },
          );
        },
      },
    );

    listeners.get("test:stream:error")?.({ chatId: 1, error: "failed" });
    listeners.get("test:stream:chunk")?.({ chatId: 1, value: "next" });

    expect(replacementOnChunk).toHaveBeenCalledWith({
      chatId: 1,
      value: "next",
    });
  });

  it("preserves a same-key stream started after invoke rejects", async () => {
    const { client, invoke, listeners } = setupStreamClient();
    const replacementOnChunk = vi.fn();
    invoke.mockRejectedValueOnce(new Error("invoke failed"));

    client.start(
      { chatId: 1 },
      {
        onChunk: vi.fn(),
        onEnd: vi.fn(),
        onError: () => {
          client.start(
            { chatId: 1 },
            {
              onChunk: replacementOnChunk,
              onEnd: vi.fn(),
              onError: vi.fn(),
            },
          );
        },
      },
    );

    await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(2));
    listeners.get("test:stream:chunk")?.({ chatId: 1, value: "next" });

    expect(replacementOnChunk).toHaveBeenCalledWith({
      chatId: 1,
      value: "next",
    });
  });

  it("routes matching generation events and keeps the absent-id fallback", () => {
    const { client, listeners } = setupStreamClient();
    const onChunk = vi.fn();
    const streamId = client.start(
      { chatId: 1 },
      { onChunk, onEnd: vi.fn(), onError: vi.fn() },
    );

    listeners.get("test:stream:chunk")?.({
      chatId: 1,
      streamId,
      value: "matched",
    });
    listeners.get("test:stream:chunk")?.({
      chatId: 1,
      value: "legacy",
    });

    expect(onChunk).toHaveBeenNthCalledWith(1, {
      chatId: 1,
      streamId,
      value: "matched",
    });
    expect(onChunk).toHaveBeenNthCalledWith(2, {
      chatId: 1,
      value: "legacy",
    });
  });

  it("drops stale events after a same-key stream is replaced", () => {
    const { client, listeners } = setupStreamClient();
    const staleCallbacks = {
      onChunk: vi.fn(),
      onEnd: vi.fn(),
      onError: vi.fn(),
    };
    const currentCallbacks = {
      onChunk: vi.fn(),
      onEnd: vi.fn(),
      onError: vi.fn(),
    };
    const staleStreamId = client.start({ chatId: 1 }, staleCallbacks);
    const currentStreamId = client.start({ chatId: 1 }, currentCallbacks);

    listeners.get("test:stream:chunk")?.({
      chatId: 1,
      streamId: staleStreamId,
      value: "stale",
    });
    listeners.get("test:stream:end")?.({
      chatId: 1,
      streamId: staleStreamId,
    });
    listeners.get("test:stream:error")?.({
      chatId: 1,
      streamId: staleStreamId,
      error: "stale",
    });
    listeners.get("test:stream:chunk")?.({
      chatId: 1,
      streamId: currentStreamId,
      value: "current",
    });

    expect(staleCallbacks.onChunk).not.toHaveBeenCalled();
    expect(staleCallbacks.onEnd).not.toHaveBeenCalled();
    expect(staleCallbacks.onError).not.toHaveBeenCalled();
    expect(currentCallbacks.onEnd).not.toHaveBeenCalled();
    expect(currentCallbacks.onError).not.toHaveBeenCalled();
    expect(currentCallbacks.onChunk).toHaveBeenCalledWith({
      chatId: 1,
      streamId: currentStreamId,
      value: "current",
    });
  });
});
