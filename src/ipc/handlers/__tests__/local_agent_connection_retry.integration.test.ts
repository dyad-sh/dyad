// @vitest-environment node
//
// Migrated from e2e-tests/local_agent_connection_retry.spec.ts.
//
// Verifies the local agent (Agent v2) automatically recovers from transient
// connection drops. The fake LLM server's connection-drop fixtures terminate
// the TCP stream mid-response on the first attempt (after streaming a partial
// chunk, or right after tool-call chunks), and the agent must retry, replay
// the completed work without duplicating it, and finish the turn cleanly.
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
import { chats, messages as messagesTable } from "@/db/schema";
import { asc, eq } from "drizzle-orm";

const countOccurrences = (haystack: string, needle: string) =>
  haystack.split(needle).length - 1;

describe("local agent connection retry (integration)", () => {
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

  it("recovers from connection drop", async () => {
    // The connection-drop fixture drops on turn 1 (after a tool turn already
    // completed) to simulate a realistic interrupted follow-up request.
    const { messages, events, eventsFor } = await harness.streamChat(
      "tc=local-agent/connection-drop",
    );

    // The turn still completed and no error leaked.
    expect(eventsFor("chat:response:error")).toHaveLength(0);
    expect(events.map((e) => e.channel)).toContain("chat:stream:end");

    const assistant = messages.find((m) => m.role === "assistant")!;
    const content = assistant.content;

    // Intro + completion text each appear exactly once (no duplicated work
    // from the retried attempt).
    expect(countOccurrences(content, "I'll create a file for you.")).toBe(1);
    expect(
      countOccurrences(
        content,
        "Successfully created the file after automatic retry.",
      ),
    ).toBe(1);

    // Partial chunks from the dropped attempt must not leak into the final
    // persisted message.
    expect(content).not.toContain("Partial response before connection dr");

    // Exactly one recovered.ts edit card (write_file tool output).
    expect(countOccurrences(content, 'path="src/recovered.ts"')).toBe(1);

    // The replayed conversation order must stay:
    // intro assistant text -> tool edit card -> completion assistant text.
    const introIdx = content.indexOf("I'll create a file for you.");
    const editIdx = content.indexOf('path="src/recovered.ts"');
    const completionIdx = content.indexOf(
      "Successfully created the file after automatic retry.",
    );
    expect(introIdx).toBeGreaterThanOrEqual(0);
    expect(editIdx).toBeGreaterThan(introIdx);
    expect(completionIdx).toBeGreaterThan(editIdx);

    // Filesystem end state (equivalent of snapshotAppFiles on src/recovered.ts).
    expect(harness.readAppFile("src/recovered.ts")).toBe(
      "export const recovered = true;\n",
    );
  }, 30_000);

  it("recovers when drop happens after tool-call stream", async () => {
    // Fresh chat: the fake server keys local-agent fixture sessions off the
    // first user message, so reusing the harness chat would replay the
    // previous test's fixture.
    const [chatRow] = await harness.db
      .insert(chats)
      .values({ appId: harness.appId })
      .returning();
    const { events, eventsFor } = await harness.streamChat(
      "tc=local-agent/connection-drop-after-tool-call",
      { chatId: chatRow.id },
    );

    expect(eventsFor("chat:response:error")).toHaveLength(0);
    expect(events.map((e) => e.channel)).toContain("chat:stream:end");

    // streamChat's `messages` are for the harness's default chat; load the
    // fresh chat's messages directly.
    const chatMessages = await harness.db.query.messages.findMany({
      where: eq(messagesTable.chatId, chatRow.id),
      orderBy: [asc(messagesTable.id)],
    });
    const assistant = chatMessages
      .filter((m) => m.role === "assistant")
      .at(-1)!;
    expect(assistant.content).toContain(
      "Successfully created the file after retrying from a tool-call termination.",
    );
    expect(assistant.content).toContain(
      'path="src/recovered-after-tool-call.ts"',
    );

    // The tool was not executed twice: the file has the single expected write
    // (equivalent of snapshotAppFiles on src/recovered-after-tool-call.ts).
    expect(harness.readAppFile("src/recovered-after-tool-call.ts")).toBe(
      "export const recoveredAfterToolCall = true;\n",
    );
  }, 30_000);
});
