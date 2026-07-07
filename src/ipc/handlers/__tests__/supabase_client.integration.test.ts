// @vitest-environment node
//
// Migrated from e2e-tests/supabase_client.spec.ts ("supabase client is
// generated").
//
// Flow: import the minimal app, stream the add-supabase fixture, connect
// Supabase via the test connect path (supabase:fake-connect-and-set-project —
// what the connect button invokes), then stream the generate-supabase-client
// fixture and verify the Supabase client file is written to the app checkout
// (the e2e's snapshotAppFiles assertion, re-snapshotted fresh here).
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  process.env.NODE_ENV = "development";
  // Enables the test-only supabase:fake-connect-and-set-project handler and
  // the mock Supabase management client (same as the Playwright suite).
  process.env.E2E_TEST_BUILD = "true";
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
import { registerSupabaseHandlers } from "@/ipc/handlers/supabase_handlers";
import { isIpcInvokeEnvelope, unwrapIpcEnvelope } from "@/ipc/contracts/core";

function makeEvent() {
  return {
    sender: {
      isDestroyed: () => false,
      isCrashed: () => false,
      send: () => {},
    },
  };
}

async function invoke(channel: string, params?: unknown): Promise<any> {
  const handler = h.ipcHandlers.get(channel);
  if (!handler) {
    throw new Error(`No handler registered for ${channel}`);
  }
  const response = await handler(makeEvent(), params);
  return isIpcInvokeEnvelope(response) ? unwrapIpcEnvelope(response) : response;
}

describe("supabase client generation (integration)", () => {
  let harness: ChatFlowHarness;

  beforeAll(async () => {
    harness = await setupChatFlowHarness({ electronMock: h });
    registerSupabaseHandlers();
  }, 30_000);

  afterAll(async () => {
    await harness?.dispose();
  });

  it("supabase client is generated", async () => {
    // First turn: the add-supabase fixture streams through the real flow.
    const addResult = await harness.streamChat("tc=add-supabase");
    expect(addResult.result).toBe(harness.chatId);

    // Connect Supabase (what the connect-supabase button does in test mode).
    await invoke("supabase:fake-connect-and-set-project", {
      appId: harness.appId,
      fakeProjectId: "fake-project-id",
    });

    // Second turn: the fixture writes the Supabase client file, which the
    // auto-approved response processor applies and commits.
    const { result, messages } = await harness.streamChat(
      "tc=generate-supabase-client",
    );
    expect(result).toBe(harness.chatId);

    const assistant = messages.filter((m) => m.role === "assistant").at(-1)!;
    expect(assistant.approvalState).toBe("approved");
    expect(assistant.commitHash).toBeTruthy();

    // The client file exists with the streamed contents (URL derived from
    // the connected fake project, publishable key from the mock API).
    const clientFile = harness.readAppFile(
      "src/integrations/supabase/client.ts",
    );
    expect(clientFile).toContain(
      'const SUPABASE_URL = "https://fake-project-id.supabase.co";',
    );
    expect(clientFile).toContain(
      'const SUPABASE_PUBLISHABLE_KEY = "test-publishable-key";',
    );
    expect(clientFile).toContain(
      "export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);",
    );

    // Full app-files snapshot (fresh equivalent of the e2e snapshotAppFiles).
    expect(harness.getAppFiles()).toMatchSnapshot();
  }, 30_000);
});
