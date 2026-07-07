// @vitest-environment node
//
// Migrated from e2e-tests/local_agent_persistent_todos.spec.ts.
//
// Persistent todos across turns:
//  - Turn 1 (`tc=local-agent/persistent-todos`): creates 3 todos, completes 1,
//    writes src/lib/utils.ts; the follow-up pass fires once but doesn't finish,
//    so the 2 incomplete todos are persisted to .dyad/todos/<chatId>.json.
//  - Turn 2 (`tc=local-agent/persistent-todos-resume`): the handler loads the
//    persisted todos, injects a synthetic "[System] You have unfinished
//    todos..." message, and the agent completes the remaining work; the todos
//    file is cleaned up once everything is completed.
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

describe("local agent persistent todos (integration)", () => {
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

  it("turn 1 persists incomplete todos to disk", async () => {
    const { messages, eventsFor } = await harness.streamChat(
      "tc=local-agent/persistent-todos",
    );
    expect(eventsFor("chat:response:error")).toHaveLength(0);

    // Pass 1 wrote the utility module.
    expect(harness.readAppFile("src/lib/utils.ts")).toBe(
      "export function formatDate(d: Date): string {\n  return d.toISOString();\n}\n",
    );

    // The follow-up pass fired (reminder injected) but didn't complete the
    // remaining todos.
    const assistant = messages.filter((m) => m.role === "assistant").at(-1)!;
    expect(assistant.content).toContain(
      "I see there are remaining tasks. I'll pick these up in the next turn.",
    );

    // Incomplete todos were persisted to .dyad/todos/<chatId>.json.
    const todosFile = `.dyad/todos/${harness.chatId}.json`;
    expect(harness.appFileExists(todosFile)).toBe(true);
    const persisted = JSON.parse(harness.readAppFile(todosFile));
    const byId = new Map(
      (persisted.todos as Array<{ id: string; status: string }>).map((t) => [
        t.id,
        t.status,
      ]),
    );
    expect(byId.get("todo-1")).toBe("completed");
    expect(byId.get("todo-2")).not.toBe("completed");
    expect(byId.get("todo-3")).not.toBe("completed");
  }, 60_000);

  it("turn 2 resumes persisted todos, completes them, and cleans up", async () => {
    const { messages, eventsFor } = await harness.streamChat(
      "tc=local-agent/persistent-todos-resume",
    );
    expect(eventsFor("chat:response:error")).toHaveLength(0);

    const assistant = messages.filter((m) => m.role === "assistant").at(-1)!;

    // At turn start the handler loaded the persisted todos from disk and
    // immediately emitted them to the renderer (this event only fires when
    // persisted todos were found).
    const todosEvents = eventsFor("agent-tool:todos-update");
    expect(todosEvents.length).toBeGreaterThan(0);
    const loaded = todosEvents[0].payload as {
      chatId: number;
      todos: Array<{ id: string; content: string; status: string }>;
    };
    expect(loaded.chatId).toBe(harness.chatId);
    const loadedById = new Map(loaded.todos.map((t) => [t.id, t]));
    expect(loadedById.get("todo-1")?.status).toBe("completed");
    expect(loadedById.get("todo-2")?.content).toBe("Add error handling");
    expect(loadedById.get("todo-2")?.status).not.toBe("completed");
    expect(loadedById.get("todo-3")?.content).toBe("Write tests");
    expect(loadedById.get("todo-3")?.status).not.toBe("completed");

    // The agent completed the remaining work.
    expect(assistant.content).toContain(
      "All tasks from the previous turn are now complete!",
    );
    expect(harness.readAppFile("src/lib/utils.ts")).toContain(
      "export function safeParseJSON(str: string): unknown {",
    );
    expect(harness.readAppFile("src/lib/utils.test.ts")).toContain(
      'test("safeParseJSON parses valid JSON", () => {',
    );

    // All todos completed -> the persisted todos file is cleaned up.
    expect(harness.appFileExists(`.dyad/todos/${harness.chatId}.json`)).toBe(
      false,
    );
  }, 60_000);
});
