// @vitest-environment node
//
// Migrated from e2e-tests/local_agent_list_files.spec.ts.
//
// Exercises the local-agent (Agent v2) list_files tool through the real
// chat:stream handler: the fake LLM streams tool calls from the
// e2e-tests/fixtures/engine/local-agent/*.ts fixtures, the real tool executes
// against the checked-out fixture app, and the resulting <dyad-list-files>
// XML (with the actual file listing) lands in the assistant message.
//
// The e2e asserted the rendered list via aria snapshots; here we assert the
// same listing directly from the persisted assistant message content.
//
// Dyad Pro engine setup: the pro model client captures DYAD_ENGINE_URL at
// module load, so a dedicated fake-LLM server is started inside vi.hoisted
// (before any app module is imported) and the env var pointed at it. The
// harness's own server still serves the catalog and dump endpoints; both are
// the same in-process express app and share fixture/dump env resolution.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const h = await vi.hoisted(async () => {
  process.env.NODE_ENV = "development";
  const { startFakeLlmServer } =
    await import("../../../../testing/fake-llm-server/index");
  const engineServer = await startFakeLlmServer();
  process.env.DYAD_ENGINE_URL = `${engineServer.url}/engine/v1`;
  process.env.DYAD_GATEWAY_URL = `${engineServer.url}/gateway/v1`;
  return { ipcHandlers: new Map(), engineServer };
});

vi.mock("electron", async () => {
  const { createElectronMock } = await import("@/testing/electron_mock");
  return createElectronMock(h);
});

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import {
  setupChatFlowHarness,
  type ChatFlowHarness,
} from "@/testing/chat_flow_harness";
import { apps, chats, messages as messagesTable } from "@/db/schema";
import { asc, eq } from "drizzle-orm";

describe("local-agent list_files (integration)", () => {
  let harness: ChatFlowHarness;

  beforeAll(async () => {
    harness = await setupChatFlowHarness({
      electronMock: h,
      chatMode: "local-agent",
      settings: {
        enableDyadPro: true,
        providerSettings: { auto: { apiKey: { value: "testdyadkey" } } },
        enableCodeExplorer: false,
      },
    });
  }, 30_000);

  afterAll(async () => {
    await harness?.dispose();
    await h.engineServer.close();
  });

  it("lists files non-recursively then recursively", async () => {
    const first = await harness.streamChat(
      "tc=local-agent/list-files-non-recursive",
      { requestedChatMode: "local-agent" },
    );
    // Note: the local-agent branch of chat:stream returns undefined (not the
    // chatId), so success is asserted via the absence of error events.
    expect(first.eventsFor("chat:response:error")).toHaveLength(0);

    const firstAssistant = first.messages[first.messages.length - 1];
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

    const second = await harness.streamChat(
      "tc=local-agent/list-files-recursive",
      { requestedChatMode: "local-agent" },
    );
    expect(second.eventsFor("chat:response:error")).toHaveLength(0);
    const secondAssistant = second.messages[second.messages.length - 1];
    expect(secondAssistant.role).toBe("assistant");
    expect(secondAssistant.content).toContain(
      'directory="src" recursive="true"',
    );
    expect(secondAssistant.content).toContain("src/App.tsx");
    expect(secondAssistant.content).toContain("src/main.tsx");
    expect(secondAssistant.content).toContain("src/vite-env.d.ts");
  }, 30_000);

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

    const { eventsFor } = await harness.streamChat(
      "tc=local-agent/list-files-include-ignored",
      { chatId: chatRow.id, requestedChatMode: "local-agent" },
    );
    expect(eventsFor("chat:response:error")).toHaveLength(0);

    // streamChat's `messages` are the harness's default chat; read this
    // chat's rows directly.
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
  }, 30_000);
});
