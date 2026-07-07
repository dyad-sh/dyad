// @vitest-environment node
//
// Migrated from e2e-tests/local_agent_cancel_todos.spec.ts.
//
// The `tc=local-agent/cancel-todos` fixture creates 2 todos (persisted to
// .dyad/todos/<chatId>.json) and then stalls (delayMs) so the test can cancel
// mid-stream, exactly like the e2e clicked "Cancel generation". On
// cancellation the handler must delete the persisted todos file and send the
// renderer an empty todos list to clear the UI.
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
import {
  createFakeIpcEvent,
  type RendererEvent,
} from "@/testing/electron_mock";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("local agent cancel clears todos (integration)", () => {
  let harness: ChatFlowHarness;

  beforeAll(async () => {
    harness = await setupChatFlowHarness({
      electronMock: h,
      chatMode: "local-agent",
      settings: {
        enableDyadPro: true,
        providerSettings: {
          auto: { apiKey: { value: "testdyadkey" } },
        },
      },
    });
  }, 30_000);

  afterAll(async () => {
    await harness?.dispose();
  });

  it("deletes persisted todos and clears the UI list on cancellation", async () => {
    const todosFile = `.dyad/todos/${harness.chatId}.json`;

    // Start the stream; the fixture creates todos, then stalls for 30s.
    const streamPromise = harness.streamChat("tc=local-agent/cancel-todos");

    // Wait until the todos have been persisted to disk (the e2e asserted the
    // same file appearing before cancelling).
    const deadline = Date.now() + 20_000;
    while (!harness.appFileExists(todosFile) && Date.now() < deadline) {
      await sleep(100);
    }
    expect(harness.appFileExists(todosFile)).toBe(true);
    const persisted = JSON.parse(harness.readAppFile(todosFile));
    expect(
      (persisted.todos as Array<{ content: string }>).map((t) => t.content),
    ).toEqual(["First cancellable task", "Second cancellable task"]);

    // Cancel the in-flight generation (what the "Cancel generation" button
    // invokes).
    const cancelHandler = h.ipcHandlers.get("chat:cancel");
    expect(cancelHandler).toBeTruthy();
    const cancelEvents: RendererEvent[] = [];
    const cancelResult = await cancelHandler(
      createFakeIpcEvent(cancelEvents),
      harness.chatId,
    );
    expect(cancelResult).toMatchObject({ ok: true, value: true });

    const { events, messages } = await streamPromise;

    // Disk: the persisted todos file is removed (no todos existed before
    // this turn).
    expect(harness.appFileExists(todosFile)).toBe(false);

    // UI: the last todos update sent to the renderer clears the list.
    const todosUpdates = events.filter(
      (e) => e.channel === "agent-tool:todos-update",
    );
    expect(todosUpdates.length).toBeGreaterThan(0);
    expect(todosUpdates.at(-1)!.payload).toMatchObject({
      chatId: harness.chatId,
      todos: [],
    });

    // The turn was recorded as cancelled.
    const assistant = messages.filter((m) => m.role === "assistant").at(-1)!;
    expect(assistant.content).toContain("[Response cancelled by user]");
  }, 60_000);
});
