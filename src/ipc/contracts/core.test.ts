import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import {
  createClient,
  createIpcErrorEnvelope,
  createIpcSuccessEnvelope,
  defineContract,
  deserializeIpcError,
  serializeIpcError,
} from "./core";

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
