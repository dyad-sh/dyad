// @vitest-environment node
//
// Migrated from e2e-tests/smart_context_balanced.spec.ts.
//
// Dyad Pro with Smart Context set to "balanced": the request must go through
// the Dyad engine with dyad_options.enable_smart_files_context=true and
// smart_context_mode="balanced", carrying the codebase as dyad_options.files
// (no versioned_files — that is deep mode). The masked request body is
// snapshotted (the e2e used the default new-app scaffold; here the minimal
// fixture, so the snapshot is regenerated, not copied).
//
// The e2e's snapshotMessages (chat UI transcript) is covered by asserting the
// db messages for the turn.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  process.env.NODE_ENV = "development";
  return { ipcHandlers: new Map() };
});

vi.mock("electron", async () => {
  const { createElectronMock } = await import("@/testing/electron_mock");
  return createElectronMock(h);
});

import type { ChatFlowHarness } from "@/testing/chat_flow_harness";
import type { FakeLlmServerHandle } from "../../../../testing/fake-llm-server/index";

describe("smart context balanced (integration)", () => {
  let harness: ChatFlowHarness;
  let engine: FakeLlmServerHandle;

  beforeAll(async () => {
    // DYAD_ENGINE_URL must exist before get_model_client.ts is imported, so
    // start a dedicated fake server first and import the harness dynamically.
    const { startFakeLlmServer } =
      await import("../../../../testing/fake-llm-server/index");
    engine = await startFakeLlmServer();
    process.env.DYAD_ENGINE_URL = `${engine.url}/engine/v1`;

    const { setupChatFlowHarness } =
      await import("@/testing/chat_flow_harness");
    harness = await setupChatFlowHarness({
      electronMock: h,
      settings: {
        enableDyadPro: true,
        proSmartContextOption: "balanced",
        providerSettings: {
          auto: {
            apiKey: { value: "testdyadkey", encryptionType: "plaintext" },
          },
        },
      },
    });
  }, 30_000);

  afterAll(async () => {
    await harness?.dispose();
    await engine?.close();
  });

  it("simple: sends balanced smart-context dyad_options to the engine", async () => {
    // The e2e pins "build" mode after Pro setup; mirror that per turn.
    const { result, messages } = await harness.streamChat("[dump]", {
      requestedChatMode: "build",
    });
    expect(result).toBe(harness.chatId);

    const dump = harness.getServerDump({ type: "request" });
    const body = dump.parsed.body as Record<string, any>;

    expect(body.model).toBe("[[MODEL]]");
    expect(body.dyad_options.enable_smart_files_context).toBe(true);
    expect(body.dyad_options.smart_context_mode).toBe("balanced");
    // Balanced mode sends plain files, not the deep-mode versioned files.
    expect(body.dyad_options.versioned_files).toBeUndefined();
    const filePaths = (body.dyad_options.files as Array<{ path: string }>).map(
      (f) => f.path,
    );
    expect(filePaths).toContain("src/App.tsx");
    expect(
      (body.dyad_options.files as Array<{ force?: boolean }>).every(
        (f) => f.force === false,
      ),
    ).toBe(true);

    expect(dump.text).toMatchSnapshot("smart-context-balanced-request");

    // Chat transcript (the e2e's snapshotMessages): the [dump] user turn and
    // the assistant reply carrying the dump marker.
    const user = messages.find((m) => m.role === "user")!;
    expect(user.content).toBe("[dump]");
    const assistant = messages.find((m) => m.role === "assistant")!;
    expect(assistant.content).toContain("[[dyad-dump-path=");
  }, 30_000);
});
