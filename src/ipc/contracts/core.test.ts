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
      input: z.object({ streamId: z.number() }),
      keyField: "streamId",
      events: {
        chunk: {
          channel: "test:stream:chunk",
          payload: z.object({ streamId: z.number(), value: z.string() }),
        },
        end: {
          channel: "test:stream:end",
          payload: z.object({ streamId: z.number() }),
        },
        error: {
          channel: "test:stream:error",
          payload: z.object({ streamId: z.number(), error: z.string() }),
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
      { streamId: 1 },
      {
        onChunk: vi.fn(),
        onEnd: () => {
          client.start(
            { streamId: 1 },
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

    listeners.get("test:stream:end")?.({ streamId: 1 });
    listeners.get("test:stream:chunk")?.({ streamId: 1, value: "next" });

    expect(replacementOnChunk).toHaveBeenCalledWith({
      streamId: 1,
      value: "next",
    });
  });

  it("preserves a same-key stream started synchronously from onError", () => {
    const { client, listeners } = setupStreamClient();
    const replacementOnChunk = vi.fn();

    client.start(
      { streamId: 1 },
      {
        onChunk: vi.fn(),
        onEnd: vi.fn(),
        onError: () => {
          client.start(
            { streamId: 1 },
            {
              onChunk: replacementOnChunk,
              onEnd: vi.fn(),
              onError: vi.fn(),
            },
          );
        },
      },
    );

    listeners.get("test:stream:error")?.({ streamId: 1, error: "failed" });
    listeners.get("test:stream:chunk")?.({ streamId: 1, value: "next" });

    expect(replacementOnChunk).toHaveBeenCalledWith({
      streamId: 1,
      value: "next",
    });
  });

  it("preserves a same-key stream started after invoke rejects", async () => {
    const { client, invoke, listeners } = setupStreamClient();
    const replacementOnChunk = vi.fn();
    invoke.mockRejectedValueOnce(new Error("invoke failed"));

    client.start(
      { streamId: 1 },
      {
        onChunk: vi.fn(),
        onEnd: vi.fn(),
        onError: () => {
          client.start(
            { streamId: 1 },
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
    listeners.get("test:stream:chunk")?.({ streamId: 1, value: "next" });

    expect(replacementOnChunk).toHaveBeenCalledWith({
      streamId: 1,
      value: "next",
    });
  });
});
