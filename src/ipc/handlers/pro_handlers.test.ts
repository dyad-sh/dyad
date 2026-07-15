// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";
import { DyadErrorKind } from "@/errors/dyad_error";
import { unwrapIpcEnvelope } from "@/ipc/contracts/core";
import { configureTrustedRenderer } from "@/ipc/utils/renderer_security";
import {
  audioContracts,
  MAX_AUDIO_FILENAME_LENGTH,
  MAX_AUDIO_RECORDING_BYTES,
  MAX_AUDIO_REQUEST_ID_LENGTH,
} from "../types/audio";

const mocks = vi.hoisted(() => ({
  ipcHandlers: new Map<string, (event: unknown, input: unknown) => unknown>(),
  readSettings: vi.fn(),
  transcribeWithDyadEngine: vi.fn(),
  fetch: vi.fn(),
  openExternal: vi.fn(),
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("electron", () => ({
  ipcMain: {
    handle: vi.fn(
      (
        channel: string,
        handler: (event: unknown, input: unknown) => unknown,
      ) => {
        mocks.ipcHandlers.set(channel, handler);
      },
    ),
  },
  shell: { openExternal: mocks.openExternal },
}));

vi.mock("node-fetch", () => ({ default: mocks.fetch }));

vi.mock("electron-log", () => ({
  default: { scope: () => mocks.logger },
}));

vi.mock("../../main/settings", () => ({
  readSettings: mocks.readSettings,
}));

vi.mock("../utils/llm_engine_provider", () => ({
  transcribeWithDyadEngine: mocks.transcribeWithDyadEngine,
}));

vi.mock("../utils/dyad_engine_url", () => ({
  getDyadEngineBaseUrl: () => "https://engine.example/v1",
}));

vi.mock("../utils/telemetry", () => ({
  sendTelemetryException: vi.fn(),
}));

vi.mock("../utils/test_utils", () => ({
  IS_TEST_BUILD: true,
}));

const { getRegisteredHandlerForTesting } = await import("./base");
const { parseBillingActionUrl, registerProHandlers } =
  await import("./pro_handlers");

configureTrustedRenderer({
  devServerUrl: "http://localhost:5173",
  packagedRendererUrl: "file:///app/renderer/main_window/index.html",
});
registerProHandlers();

const transcribeAudio = getRegisteredHandlerForTesting(
  audioContracts.transcribeAudio.channel,
);
const getSubscriptionStatus = getRegisteredHandlerForTesting(
  "get-subscription-status",
);
const openBillingAction = getRegisteredHandlerForTesting("open-billing-action");

describe("pro audio transcription handler", () => {
  beforeEach(() => {
    mocks.readSettings.mockReset();
    mocks.readSettings.mockReturnValue({
      enableDyadPro: true,
      providerSettings: {
        auto: { apiKey: { value: "test-api-key" } },
      },
    });
    mocks.transcribeWithDyadEngine.mockReset();
    mocks.transcribeWithDyadEngine.mockResolvedValue("transcribed text");
  });

  it("transcribes a bounded typed array through a zero-copy Buffer view", async () => {
    const audioData = new Uint8Array([1, 2, 3, 4]);

    await expect(
      transcribeAudio({} as never, {
        audioData,
        filename: "recording.webm",
        requestId: "request-123",
      }),
    ).resolves.toEqual({ text: "transcribed text" });

    expect(mocks.transcribeWithDyadEngine).toHaveBeenCalledTimes(1);
    const audioBuffer = mocks.transcribeWithDyadEngine.mock.calls[0][0];
    expect(Buffer.isBuffer(audioBuffer)).toBe(true);
    expect([...audioBuffer]).toEqual([1, 2, 3, 4]);
    audioData[0] = 9;
    expect(audioBuffer[0]).toBe(9);
    expect(mocks.transcribeWithDyadEngine).toHaveBeenCalledWith(
      audioBuffer,
      "recording.webm",
      "request-123",
      expect.objectContaining({
        apiKey: "test-api-key",
        baseURL: "https://engine.example/v1",
      }),
    );
  });

  it.each([
    {
      name: "oversized audio",
      input: {
        audioData: new Uint8Array(MAX_AUDIO_RECORDING_BYTES + 1),
        filename: "recording.webm",
        requestId: "request-123",
      },
    },
    {
      name: "oversized filename",
      input: {
        audioData: new Uint8Array([1]),
        filename: "a".repeat(MAX_AUDIO_FILENAME_LENGTH + 1),
        requestId: "request-123",
      },
    },
    {
      name: "oversized request ID",
      input: {
        audioData: new Uint8Array([1]),
        filename: "recording.webm",
        requestId: "r".repeat(MAX_AUDIO_REQUEST_ID_LENGTH + 1),
      },
    },
    {
      name: "traversal filename",
      input: {
        audioData: new Uint8Array([1]),
        filename: "..",
        requestId: "request-123",
      },
    },
    {
      name: "whitespace-padded traversal filename",
      input: {
        audioData: new Uint8Array([1]),
        filename: " .. ",
        requestId: "request-123",
      },
    },
    {
      name: "header-unsafe request ID",
      input: {
        audioData: new Uint8Array([1]),
        filename: "recording.webm",
        requestId: "request\r\nX-Injected: true",
      },
    },
  ])("rejects $name before calling the engine", async ({ input }) => {
    await expect(transcribeAudio({} as never, input)).rejects.toMatchObject({
      kind: DyadErrorKind.Validation,
    });
    expect(mocks.transcribeWithDyadEngine).not.toHaveBeenCalled();
  });

  it("classifies a missing Pro subscription as an auth error", async () => {
    mocks.readSettings.mockReturnValue({
      enableDyadPro: false,
      providerSettings: {},
    });

    await expect(
      transcribeAudio({} as never, {
        audioData: new Uint8Array([1]),
        filename: "recording.webm",
        requestId: "request-123",
      }),
    ).rejects.toMatchObject({ kind: DyadErrorKind.Auth });
    expect(mocks.transcribeWithDyadEngine).not.toHaveBeenCalled();
  });

  it("rejects transcription IPC from an untrusted renderer", async () => {
    const ipcHandler = mocks.ipcHandlers.get(
      audioContracts.transcribeAudio.channel,
    );
    expect(ipcHandler).toBeDefined();
    const frame = { url: "https://attacker.example/" };
    const envelope = await ipcHandler!(
      { sender: { mainFrame: frame }, senderFrame: frame },
      {
        audioData: new Uint8Array([1]),
        filename: "recording.webm",
        requestId: "request-123",
      },
    );

    expect(() => unwrapIpcEnvelope(envelope as never)).toThrow(
      "trusted Dyad renderer",
    );
    expect(mocks.readSettings).not.toHaveBeenCalled();
    expect(mocks.transcribeWithDyadEngine).not.toHaveBeenCalled();
  });
});

describe("subscription status handlers", () => {
  beforeEach(() => {
    process.env.DYAD_SUBSCRIPTION_STATUS_URL =
      "https://academy.test/api/desktop/subscription-status";
    mocks.fetch.mockReset();
    mocks.openExternal.mockReset();
    mocks.readSettings.mockReturnValue({
      providerSettings: {
        auto: { apiKey: { value: "stored-pro-key" } },
      },
    });
  });

  it("sends the stored bearer key and validates the response", async () => {
    mocks.fetch.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        alert: "subscription_ending",
        effectiveAt: "2026-08-03T00:00:00.000Z",
        actionUrl: "https://academy.dyad.sh/subscription?source=app",
      }),
    });

    await expect(
      getSubscriptionStatus({} as never, undefined),
    ).resolves.toEqual({
      alert: "subscription_ending",
      effectiveAt: "2026-08-03T00:00:00.000Z",
      actionUrl: "https://academy.dyad.sh/subscription?source=app",
    });
    expect(mocks.fetch).toHaveBeenCalledWith(
      "https://academy.test/api/desktop/subscription-status",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer stored-pro-key",
        }),
      }),
    );
  });

  it("returns null without a configured key", async () => {
    mocks.readSettings.mockReturnValue({ providerSettings: {} });
    await expect(
      getSubscriptionStatus({} as never, undefined),
    ).resolves.toBeNull();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: "unauthorized response",
      response: { ok: false, status: 401 },
    },
    {
      name: "malformed response",
      response: {
        ok: true,
        json: vi.fn().mockResolvedValue({ alert: "expired" }),
      },
    },
  ])("returns null for a $name", async ({ response }) => {
    mocks.fetch.mockResolvedValue(response);
    await expect(
      getSubscriptionStatus({} as never, undefined),
    ).resolves.toBeNull();
  });

  it("returns null for a network failure", async () => {
    mocks.fetch.mockRejectedValue(new Error("offline"));
    await expect(
      getSubscriptionStatus({} as never, undefined),
    ).resolves.toBeNull();
  });

  it.each([
    "http://academy.dyad.sh/subscription",
    "https://example.com/subscription",
    "https://user:pass@academy.dyad.sh/subscription",
    "https://academy.dyad.sh:8443/subscription",
    "not a URL",
  ])("rejects unsafe billing URL %s", (url) => {
    expect(() => parseBillingActionUrl(url)).toThrow(
      "Invalid billing action URL",
    );
  });

  it("accepts and opens an Academy HTTPS billing URL", async () => {
    const url = "https://academy.dyad.sh/subscription?source=app";
    expect(parseBillingActionUrl(url)).toBe(url);
    await expect(openBillingAction({} as never, url)).resolves.toBeUndefined();
    expect(mocks.openExternal).not.toHaveBeenCalled();
  });
});
