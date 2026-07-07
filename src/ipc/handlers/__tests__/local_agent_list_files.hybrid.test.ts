// Migrated from e2e-tests/local_agent_list_files.spec.ts, then converted from
// the node chat-flow harness to the HYBRID harness (real <ChatPanel> over the
// real IPC stack).
//
// Exercises the local-agent (Agent v2) list_files tool through the real
// chat:stream handler: the fake LLM streams tool calls from the
// e2e-tests/fixtures/engine/local-agent/*.ts fixtures, the real tool executes
// against the checked-out fixture app, and the resulting <dyad-list-files>
// XML (with the actual file listing) lands in the assistant message.
//
// The e2e asserted the rendered list via aria snapshots; the hybrid harness
// renders the same DyadListFiles cards in the DOM (asserted below via
// data-testid="dyad-list-files"), and the same listing is still asserted
// from the persisted assistant message content, as in the node version.
//
// Dyad Pro engine setup: the pro model client captures DYAD_ENGINE_URL at
// module load, so a dedicated fake-LLM server is started inside vi.hoisted
// (before any app module is imported) and the env var pointed at it. The
// harness's own server still serves the catalog and dump endpoints; both are
// the same in-process express app and share fixture/dump env resolution.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const engineServer = await vi.hoisted(async () => {
  const { startFakeLlmServer } =
    await import("../../../../testing/fake-llm-server/index");
  const engineServer = await startFakeLlmServer();
  process.env.DYAD_ENGINE_URL = `${engineServer.url}/engine/v1`;
  process.env.DYAD_GATEWAY_URL = `${engineServer.url}/gateway/v1`;
  return engineServer;
});

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { screen, waitFor } from "@testing-library/react";

import {
  setupHybridChatHarness,
  type HybridChatHarness,
} from "@/testing/hybrid_chat_harness";
import { h } from "@/testing/hybrid.setup";
import { apps, chats, messages as messagesTable } from "@/db/schema";
import { asc, eq } from "drizzle-orm";

describe("local-agent list_files (integration)", () => {
  let harness: HybridChatHarness;

  beforeAll(async () => {
    harness = await setupHybridChatHarness({
      electronMock: h,
      chatMode: "local-agent",
      settings: {
        isTestMode: true,
        enableDyadPro: true,
        providerSettings: { auto: { apiKey: { value: "testdyadkey" } } },
        enableCodeExplorer: false,
      },
    });
  }, 60_000);

  afterAll(async () => {
    await harness?.dispose();
    await engineServer.close();
  });

  it("lists files non-recursively then recursively", async () => {
    harness.mount();
    await waitFor(
      () => {
        expect(screen.getByTestId("messages-list")).toBeTruthy();
        expect(screen.getByTestId("chat-input-container")).toBeTruthy();
      },
      { timeout: 15_000 },
    );

    // First turn: non-recursive listing.
    const { send } = await harness.typeInChat(
      "tc=local-agent/list-files-non-recursive",
    );
    send();

    // The list_files tool card renders in the DOM — the same surface the e2e
    // asserted via aria snapshots.
    await waitFor(
      () => expect(screen.getByTestId("dyad-list-files")).toBeTruthy(),
      { timeout: 20_000 },
    );
    await waitFor(
      () =>
        expect(
          screen.getByText(/Here are the files in the src directory\./),
        ).toBeTruthy(),
      { timeout: 20_000 },
    );

    await harness.waitForStreamEnd(harness.chatId);
    // Note: the local-agent branch of chat:stream returns undefined (not the
    // chatId), so success is asserted via the absence of error events.
    expect(
      harness.bridge.sentEvents.filter(
        (e) => e.channel === "chat:response:error",
      ),
    ).toHaveLength(0);

    const firstMessages = await harness.db.query.messages.findMany({
      where: eq(messagesTable.chatId, harness.chatId),
      orderBy: [asc(messagesTable.id)],
    });
    const firstAssistant = firstMessages[firstMessages.length - 1];
    expect(firstAssistant.role).toBe("assistant");
    expect(firstAssistant.content).toContain(
      "I'll list the files in the src directory for you.",
    );
    expect(firstAssistant.content).toContain(
      'directory="src" recursive="false"',
    );
    expect(firstAssistant.content).toContain("src/App.tsx");
    expect(firstAssistant.content).toContain("src/main.tsx");
    expect(firstAssistant.content).toContain("src/vite-env.d.ts");
    expect(firstAssistant.content).toContain(
      "Here are the files in the src directory.",
    );

    // Second turn: recursive listing. Baseline-aware end gate (turn 2 in the
    // same chat — plain waitForStreamEnd would match turn 1's stale event).
    const secondEnd = harness.waitForNextStreamEnd(harness.chatId);
    const { send: sendSecond } = await harness.typeInChat(
      "tc=local-agent/list-files-recursive",
    );
    sendSecond();

    // A second list_files card renders for the recursive turn.
    await waitFor(
      () =>
        expect(screen.getAllByTestId("dyad-list-files").length).toBeGreaterThan(
          1,
        ),
      { timeout: 20_000 },
    );

    await secondEnd;
    expect(
      harness.bridge.sentEvents.filter(
        (e) => e.channel === "chat:response:error",
      ),
    ).toHaveLength(0);

    const secondMessages = await harness.db.query.messages.findMany({
      where: eq(messagesTable.chatId, harness.chatId),
      orderBy: [asc(messagesTable.id)],
    });
    const secondAssistant = secondMessages[secondMessages.length - 1];
    expect(secondAssistant.role).toBe("assistant");
    expect(secondAssistant.content).toContain(
      'directory="src" recursive="true"',
    );
    expect(secondAssistant.content).toContain("src/App.tsx");
    expect(secondAssistant.content).toContain("src/main.tsx");
    expect(secondAssistant.content).toContain("src/vite-env.d.ts");

    // Every channel the UI invoked had a real handler.
    expect([...harness.bridge.missingChannels]).toEqual([]);
  }, 60_000);

  it("lists ignored files with include_ignored", async () => {
    // The e2e used the minimal-with-dyad fixture app (it has a git-ignored
    // .dyad/plans/test-plan.md). Check it out as a second app in this
    // harness's temp root and run the fixture in its own chat.
    const fixtureAppDir = path.join(
      process.cwd(),
      "e2e-tests",
      "fixtures",
      "import-app",
      "minimal-with-dyad",
    );
    const appDir = path.join(path.dirname(harness.appDir), "app-with-dyad");
    fs.cpSync(fixtureAppDir, appDir, { recursive: true });
    const git = (...args: string[]) =>
      execFileSync(
        "git",
        [
          "-c",
          "user.email=test@example.com",
          "-c",
          "user.name=Test User",
          ...args,
        ],
        { cwd: appDir, stdio: "pipe" },
      );
    git("init");
    git("add", "-A");
    git("commit", "-m", "init");

    const [appRow] = await harness.db
      .insert(apps)
      .values({ name: "minimal-with-dyad", path: appDir })
      .returning();
    const [chatRow] = await harness.db
      .insert(chats)
      .values({ appId: appRow.id })
      .returning();

    harness.mount({ chatId: chatRow.id, appId: appRow.id });
    await waitFor(
      () => {
        expect(screen.getByTestId("messages-list")).toBeTruthy();
        expect(screen.getByTestId("chat-input-container")).toBeTruthy();
      },
      { timeout: 15_000 },
    );

    // Baseline-aware end gate: the previous it already produced
    // chat:response:end events on this bridge.
    const streamEnd = harness.waitForNextStreamEnd(chatRow.id);
    const { send } = await harness.typeInChat(
      "tc=local-agent/list-files-include-ignored",
      { chatId: chatRow.id },
    );
    send();

    // The list_files tool card renders in the DOM with the ignored .dyad file.
    await waitFor(
      () => expect(screen.getByTestId("dyad-list-files")).toBeTruthy(),
      { timeout: 20_000 },
    );
    await waitFor(
      () =>
        expect(
          screen.getByText(/Here are the ignored \.dyad files\./),
        ).toBeTruthy(),
      { timeout: 20_000 },
    );

    await streamEnd;
    expect(
      harness.bridge.sentEvents.filter(
        (e) => e.channel === "chat:response:error",
      ),
    ).toHaveLength(0);

    // Read this chat's rows directly.
    const chatMessages = await harness.db.query.messages.findMany({
      where: eq(messagesTable.chatId, chatRow.id),
      orderBy: [asc(messagesTable.id)],
    });
    const assistant = chatMessages[chatMessages.length - 1];
    expect(assistant.role).toBe("assistant");
    expect(assistant.content).toContain(
      'directory=".dyad" recursive="true" include_ignored="true"',
    );
    expect(assistant.content).toContain(".dyad/plans/test-plan.md");
    expect(assistant.content).toContain("Here are the ignored .dyad files.");

    // Every channel the UI invoked had a real handler.
    expect([...harness.bridge.missingChannels]).toEqual([]);
  }, 60_000);
});
