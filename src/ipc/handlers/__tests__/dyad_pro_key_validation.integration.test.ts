// @vitest-environment node
//
// Migrated from e2e-tests/dyad_pro_key_validation.spec.ts.
//
// The Dyad engine (a LiteLLM proxy) reports invalid keys as an SSE error
// event on an HTTP 200 response rather than an HTTP 401. The e2e drove the
// Settings UI: saving an invalid Dyad API key surfaced the "API key rejected"
// dialog (and did NOT save the key), then a valid key saved successfully and
// enabled Dyad Pro. The main-process behavior under test is the
// validate-provider-api-key IPC handler; the dialog itself and the renderer's
// subsequent settings write are UI wiring (dropped as UI-only).
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  process.env.NODE_ENV = "development";
  return { ipcHandlers: new Map() };
});

vi.mock("electron", async () => {
  const { createElectronMock } = await import("@/testing/electron_mock");
  return createElectronMock(h);
});

import {
  setupChatFlowHarness,
  type ChatFlowHarness,
} from "@/testing/chat_flow_harness";
import { registerSettingsHandlers } from "@/ipc/handlers/settings_handlers";
import { createFakeIpcEvent } from "@/testing/electron_mock";
import { readSettings } from "@/main/settings";

interface IpcEnvelope {
  ok: boolean;
  value?: unknown;
  error?: { message?: string; kind?: string };
}

describe("dyad pro key validation (integration)", () => {
  let harness: ChatFlowHarness;

  const invokeValidate = async (apiKey: string): Promise<IpcEnvelope> => {
    const handler = h.ipcHandlers.get("validate-provider-api-key") as (
      event: unknown,
      input: unknown,
    ) => Promise<IpcEnvelope>;
    expect(handler).toBeDefined();
    return handler(createFakeIpcEvent([]), { provider: "auto", apiKey });
  };

  beforeAll(async () => {
    harness = await setupChatFlowHarness({ electronMock: h });
    // The validation service reads DYAD_ENGINE_URL at call time; the e2e set
    // it before app launch so the engine points at the fake server.
    process.env.DYAD_ENGINE_URL = `${harness.fakeLlmUrl}/engine/v1`;
    registerSettingsHandlers();
  }, 30_000);

  afterAll(async () => {
    await harness?.dispose();
    delete process.env.DYAD_ENGINE_URL;
  });

  it("rejects an invalid Dyad Pro key reported via an in-stream SSE error", async () => {
    const envelope = await invokeValidate("invalid-dyad-key");

    expect(envelope.ok).toBe(false);
    expect(envelope.error?.message).toBe(
      "Dyad rejected this API key. Try another API key or keep this one anyway.",
    );

    // Nothing was saved: no Dyad provider settings, Dyad Pro not enabled.
    const settings = readSettings();
    expect(settings.providerSettings?.auto).toBeUndefined();
    expect(settings.enableDyadPro).not.toBe(true);
  }, 30_000);

  it("accepts a valid Dyad Pro key", async () => {
    const envelope = await invokeValidate("testdyadkey");

    expect(envelope.ok).toBe(true);
    expect(envelope.value).toEqual({ ok: true });
  }, 30_000);
});
