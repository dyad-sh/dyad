// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import {
  defineContract,
  unwrapIpcEnvelope,
  type IpcInvokeEnvelope,
} from "../contracts/core";
import {
  configureTrustedRenderer,
  isTrustedRendererUrl,
} from "../utils/renderer_security";

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, input: unknown) => unknown>(),
  sendTelemetryException: vi.fn(),
}));

vi.mock("electron", () => ({
  ipcMain: {
    handle: vi.fn(
      (channel: string, fn: (event: unknown, input: unknown) => unknown) => {
        mocks.handlers.set(channel, fn);
      },
    ),
  },
}));

vi.mock("../utils/telemetry", () => ({
  sendTelemetryException: mocks.sendTelemetryException,
}));

vi.mock("../utils/test_utils", () => ({
  IS_TEST_BUILD: true,
}));

const { createLoggedTypedHandler, createTypedHandler } = await import("./base");
const { createLoggedHandler } = await import("./safe_handle");

function getEnvelope(
  channel: string,
  input?: unknown,
  event: unknown = (() => {
    const frame = { url: "http://localhost:5173/" };
    return { sender: { mainFrame: frame }, senderFrame: frame };
  })(),
): Promise<IpcInvokeEnvelope> {
  const handler = mocks.handlers.get(channel);
  if (!handler) {
    throw new Error(`No handler registered for ${channel}`);
  }
  return Promise.resolve(handler(event, input) as IpcInvokeEnvelope);
}

describe("IPC handler envelopes", () => {
  beforeEach(() => {
    mocks.handlers.clear();
    mocks.sendTelemetryException.mockClear();
    configureTrustedRenderer({
      devServerUrl: "http://localhost:5173",
      packagedRendererUrl: "file:///app/renderer/main_window/index.html",
    });
  });

  it("returns success envelopes from typed handlers", async () => {
    createTypedHandler(
      defineContract({
        channel: "ok-channel",
        input: z.object({ value: z.number() }),
        output: z.object({ doubled: z.number() }),
      }),
      async (_, input) => ({ doubled: input.value * 2 }),
    );

    const envelope = await getEnvelope("ok-channel", { value: 21 });

    expect(unwrapIpcEnvelope(envelope)).toEqual({ doubled: 42 });
    expect(mocks.sendTelemetryException).not.toHaveBeenCalled();
  });

  it("accepts IPC from the local development renderer", async () => {
    const previousNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "development";
    try {
      createTypedHandler(
        defineContract({
          channel: "local-renderer-channel",
          input: z.object({}),
          output: z.object({ ok: z.literal(true) }),
        }),
        async () => ({ ok: true as const }),
      );
      const frame = { url: "http://localhost:5173/" };
      const envelope = await getEnvelope(
        "local-renderer-channel",
        {},
        {
          sender: { mainFrame: frame },
          senderFrame: frame,
        },
      );
      expect(unwrapIpcEnvelope(envelope)).toEqual({ ok: true });
    } finally {
      process.env.NODE_ENV = previousNodeEnv;
    }
  });

  it("accepts IPC from the packaged renderer entry", async () => {
    configureTrustedRenderer({
      packagedRendererUrl: "file:///app/renderer/main_window/index.html",
    });
    createTypedHandler(
      defineContract({
        channel: "packaged-renderer-channel",
        input: z.object({}),
        output: z.object({ ok: z.literal(true) }),
      }),
      async () => ({ ok: true as const }),
    );
    const frame = { url: "file:///app/renderer/main_window/index.html" };
    const envelope = await getEnvelope(
      "packaged-renderer-channel",
      {},
      {
        sender: { mainFrame: frame },
        senderFrame: frame,
      },
    );
    expect(unwrapIpcEnvelope(envelope)).toEqual({ ok: true });
  });

  it.each([
    "file:///",
    "file:///?appId=42#preview",
    "file:///chat?chatId=42#message-3",
    "file:///settings/",
    "file:///providers/openai?section=models",
    "file:///providers/custom%3A%3Atesting",
    "file:///library/media#asset-1",
  ])("accepts IPC from packaged SPA location %s", async (url) => {
    configureTrustedRenderer({
      packagedRendererUrl: "file:///app/renderer/main_window/index.html",
    });
    createTypedHandler(
      defineContract({
        channel: "packaged-route-channel",
        input: z.object({}),
        output: z.object({ ok: z.literal(true) }),
      }),
      async () => ({ ok: true as const }),
    );
    const frame = { url };
    const envelope = await getEnvelope(
      "packaged-route-channel",
      {},
      { sender: { mainFrame: frame }, senderFrame: frame },
    );
    expect(unwrapIpcEnvelope(envelope)).toEqual({ ok: true });
  });

  it("accepts distinct wrappers for the packaged main frame", async () => {
    configureTrustedRenderer({
      packagedRendererUrl: "file:///app/renderer/main_window/index.html",
    });
    createTypedHandler(
      defineContract({
        channel: "packaged-distinct-wrapper-channel",
        input: z.object({}),
        output: z.object({ ok: z.literal(true) }),
      }),
      async () => ({ ok: true as const }),
    );
    const mainFrame = {
      url: "file:///providers/custom%3A%3Atesting",
      processId: 42,
      routingId: 7,
      parent: null,
    };
    const senderFrame = { ...mainFrame };
    expect(senderFrame).not.toBe(mainFrame);

    const envelope = await getEnvelope(
      "packaged-distinct-wrapper-channel",
      {},
      { sender: { mainFrame }, senderFrame },
    );

    expect(unwrapIpcEnvelope(envelope)).toEqual({ ok: true });
  });

  it("rejects a packaged child frame even when its URL is allowlisted", async () => {
    configureTrustedRenderer({
      packagedRendererUrl: "file:///app/renderer/main_window/index.html",
    });
    const implementation = vi.fn(async () => ({ ok: true as const }));
    createTypedHandler(
      defineContract({
        channel: "packaged-child-frame-channel",
        input: z.object({}),
        output: z.object({ ok: z.literal(true) }),
      }),
      implementation,
    );
    const mainFrame = {
      url: "file:///providers/custom%3A%3Atesting",
      processId: 42,
      routingId: 7,
      parent: null,
    };
    const senderFrame = {
      url: "file:///providers/custom%3A%3Atesting",
      processId: 42,
      routingId: 8,
      parent: mainFrame,
    };

    const envelope = await getEnvelope(
      "packaged-child-frame-channel",
      {},
      { sender: { mainFrame }, senderFrame },
    );

    expect(() => unwrapIpcEnvelope(envelope)).toThrow("trusted Dyad renderer");
    expect(implementation).not.toHaveBeenCalled();
  });

  it("normalizes the Windows file-volume prefix for packaged SPA routes", () => {
    configureTrustedRenderer({
      packagedRendererUrl:
        "file:///C:/Program%20Files/Dyad/renderer/main_window/index.html",
    });

    for (const url of [
      "file:///C:/Program%20Files/Dyad/renderer/main_window/index.html",
      "file:///C:/",
      "file:///C:/chat?chatId=42#message-3",
      "file:///C:/providers/openai?section=models",
      "file:///C:/providers/custom%3A%3Atesting",
    ]) {
      expect(isTrustedRendererUrl(url), url).toBe(true);
    }
    for (const url of [
      "file:///chat",
      "file:///D:/chat",
      "file:///C:/tmp/payload.html",
      "file://attacker.example/C:/chat",
    ]) {
      expect(isTrustedRendererUrl(url), url).toBe(false);
    }
  });

  it("rejects IPC from a remote renderer origin", async () => {
    const previousNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "development";
    try {
      createTypedHandler(
        defineContract({
          channel: "remote-renderer-channel",
          input: z.object({}),
          output: z.void(),
        }),
        async () => undefined,
      );
      const frame = { url: "https://attacker.example/" };
      const envelope = await getEnvelope(
        "remote-renderer-channel",
        {},
        {
          sender: { mainFrame: frame },
          senderFrame: frame,
        },
      );
      expect(() => unwrapIpcEnvelope(envelope)).toThrow(
        "trusted Dyad renderer",
      );
      expect(mocks.sendTelemetryException).toHaveBeenCalledTimes(1);
    } finally {
      process.env.NODE_ENV = previousNodeEnv;
    }
  });

  it("rejects missing frames, arbitrary files, and other localhost ports", async () => {
    const previousNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "development";
    try {
      createTypedHandler(
        defineContract({
          channel: "invalid-renderer-channel",
          input: z.object({}),
          output: z.void(),
        }),
        async () => undefined,
      );
      const invalidUrls = [
        "file:///tmp/payload.html",
        "file:///unknown-renderer-route",
        "file:///chat/payload.html",
        "file:///providers/openai/payload.html",
        "file:///settings/providers/openai",
        "file://attacker.example/chat",
        "file://attacker.example/providers/openai",
        "https://attacker.example/chat",
        "https://attacker.example/providers/openai",
        "https://attacker.example/app/renderer/main_window/index.html",
        "http://localhost:5174/",
        "https://attacker.example/",
      ];
      for (const url of invalidUrls) {
        const frame = { url };
        const envelope = await getEnvelope(
          "invalid-renderer-channel",
          {},
          { sender: { mainFrame: frame }, senderFrame: frame },
        );
        expect(() => unwrapIpcEnvelope(envelope)).toThrow(
          "trusted Dyad renderer",
        );
      }

      const mainFrame = { url: "http://localhost:5173/" };
      const invalidEvents = [
        { sender: { mainFrame } },
        {
          sender: { mainFrame },
          senderFrame: { url: "http://localhost:5173/" },
        },
      ];
      for (const event of invalidEvents) {
        const envelope = await getEnvelope(
          "invalid-renderer-channel",
          {},
          event,
        );
        expect(() => unwrapIpcEnvelope(envelope)).toThrow(
          "trusted Dyad renderer",
        );
      }
    } finally {
      process.env.NODE_ENV = previousNodeEnv;
    }
  });

  it("returns validation DyadError envelopes from typed handlers", async () => {
    createTypedHandler(
      defineContract({
        channel: "validation-channel",
        input: z.object({ value: z.number() }),
        output: z.void(),
      }),
      async () => undefined,
    );

    const envelope = await getEnvelope("validation-channel", { value: "nope" });

    expect(() => unwrapIpcEnvelope(envelope)).toThrow(DyadError);
    expect(() => unwrapIpcEnvelope(envelope)).toThrow(
      "[validation-channel] Invalid input",
    );
    expect(envelope.ok).toBe(false);
    if (!envelope.ok) {
      expect(envelope.error.kind).toBe(DyadErrorKind.Validation);
    }
    expect(mocks.sendTelemetryException).not.toHaveBeenCalled();
  });

  it("returns handler DyadError envelopes after telemetry", async () => {
    createTypedHandler(
      defineContract({
        channel: "error-channel",
        input: z.object({}),
        output: z.void(),
      }),
      async () => {
        throw new DyadError("Already exists", DyadErrorKind.Conflict);
      },
    );

    const envelope = await getEnvelope("error-channel", {});

    expect(envelope.ok).toBe(false);
    if (!envelope.ok) {
      expect(envelope.error.kind).toBe(DyadErrorKind.Conflict);
      expect(envelope.error.message).toBe("Already exists");
    }
    expect(() => unwrapIpcEnvelope(envelope)).toThrow(DyadError);
    expect(mocks.sendTelemetryException).toHaveBeenCalledTimes(1);
  });

  it("returns envelopes from legacy logged handlers", async () => {
    const logger = {
      debug: vi.fn(),
      log: vi.fn(),
      error: vi.fn(),
    };
    const handle = createLoggedHandler(logger as any);
    handle("legacy-channel", async () => {
      throw new DyadError("Legacy conflict", DyadErrorKind.Conflict);
    });

    const envelope = await getEnvelope("legacy-channel");

    expect(envelope.ok).toBe(false);
    if (!envelope.ok) {
      expect(envelope.error.kind).toBe(DyadErrorKind.Conflict);
      expect(envelope.error.message).toBe("Legacy conflict");
    }
    expect(mocks.sendTelemetryException).toHaveBeenCalledTimes(1);
  });

  it("rejects remote origins in legacy logged handlers too", async () => {
    const logger = {
      debug: vi.fn(),
      log: vi.fn(),
      error: vi.fn(),
    };
    const handle = createLoggedHandler(logger as any);
    handle("legacy-remote-channel", async () => ({ ok: true }));
    const frame = { url: "https://attacker.example/" };
    const envelope = await getEnvelope("legacy-remote-channel", undefined, {
      sender: { mainFrame: frame },
      senderFrame: frame,
    });
    expect(() => unwrapIpcEnvelope(envelope)).toThrow("trusted Dyad renderer");
  });

  it("rejects remote origins in logged typed handlers too", async () => {
    const logger = {
      info: vi.fn(),
      error: vi.fn(),
    };
    const implementation = vi.fn(async () => ({ ok: true as const }));
    const handle = createLoggedTypedHandler(logger);
    handle(
      defineContract({
        channel: "logged-typed-remote-channel",
        input: z.object({}),
        output: z.object({ ok: z.literal(true) }),
      }),
      implementation,
    );
    const frame = { url: "https://attacker.example/" };
    const envelope = await getEnvelope(
      "logged-typed-remote-channel",
      {},
      { sender: { mainFrame: frame }, senderFrame: frame },
    );

    expect(() => unwrapIpcEnvelope(envelope)).toThrow("trusted Dyad renderer");
    expect(implementation).not.toHaveBeenCalled();
    expect(mocks.sendTelemetryException).toHaveBeenCalledTimes(1);
  });
});
