// @vitest-environment node
//
// Migrated from e2e-tests/local_agent_todo_followup.spec.ts.
//
// Tests the outer-loop todo follow-up behavior (#2601): the
// `tc=local-agent/todo-followup-loop` fixture creates 3 todos in pass 1 but
// completes only one; the outer loop must detect the incomplete todos, inject
// a reminder, and run a second pass in which the agent finishes the rest.
// We assert the files written in BOTH passes plus transcript evidence that
// both passes ran within a single turn.
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

describe("local agent todo follow-up loop (integration)", () => {
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

  it("runs a second pass to complete remaining todos", async () => {
    const { messages, eventsFor } = await harness.streamChat(
      "tc=local-agent/todo-followup-loop",
    );
    expect(eventsFor("chat:response:error")).toHaveLength(0);

    // Pass 1 file.
    expect(harness.readAppFile("src/utils/helper.ts")).toBe(
      "export function helper(x: number): number {\n  return x * 2;\n}\n",
    );
    // Pass 2 files (only written if the follow-up loop actually ran).
    expect(harness.readAppFile("src/utils/helper.test.ts")).toBe(
      'import { helper } from "./helper";\n\ntest("helper doubles input", () => {\n  expect(helper(5)).toBe(10);\n});\n',
    );
    expect(harness.readAppFile("src/utils/README.md")).toBe(
      "# Utils\n\n## helper(x)\n\nDoubles the input number.\n",
    );

    // Both passes are recorded in the single assistant turn: pass 1's
    // closing text and pass 2's completion text.
    const assistant = messages.filter((m) => m.role === "assistant").at(-1)!;
    expect(assistant.content).toContain(
      "I've completed the utility function. Let me continue with the remaining tasks.",
    );
    expect(assistant.content).toContain(
      "All tasks are now complete! I've created the utility function, written unit tests, and updated the documentation.",
    );

    // All todos were completed by the end of the turn, so no incomplete
    // todos were persisted for the next turn.
    expect(harness.appFileExists(`.dyad/todos/${harness.chatId}.json`)).toBe(
      false,
    );
  }, 60_000);
});
