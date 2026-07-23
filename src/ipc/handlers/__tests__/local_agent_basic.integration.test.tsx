import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { fireEvent, screen, waitFor } from "@testing-library/react";
import { eq } from "drizzle-orm";

import { apps, chats, messages } from "@/db/schema";
import {
  deleteAppBlueprintForChat,
  getAppBlueprintForChat,
} from "@/ipc/handlers/app_blueprint_handlers";
import { ensureGitLineEndingPolicy } from "@/ipc/utils/git_utils";
import {
  setupHybridChatHarness,
  type HybridChatHarness,
} from "@/testing/hybrid_chat_harness";
import { h } from "@/testing/hybrid.setup";

describe("local-agent basic flows (integration)", () => {
  let harness: HybridChatHarness;
  let appCounter = 0;

  beforeAll(async () => {
    harness = await setupHybridChatHarness({
      electronMock: h,
      engine: true,
      chatMode: "local-agent",
      settings: {
        isTestMode: true,
        enableDyadPro: true,
        providerSettings: { auto: { apiKey: { value: "testdyadkey" } } },
      },
    });
  }, 60_000);

  afterAll(async () => {
    await harness?.dispose();
  });

  async function createMinimalApp(options: {
    name: string;
    needsAppBlueprint?: boolean;
  }) {
    appCounter += 1;
    const fixtureAppDir = path.join(
      process.cwd(),
      "e2e-tests",
      "fixtures",
      "import-app",
      "minimal",
    );
    const appDir = path.join(
      path.dirname(harness.appDir),
      `${options.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${appCounter}`,
    );
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
    await ensureGitLineEndingPolicy({
      path: appDir,
      writeGitattributes: true,
    });
    git("add", "-A");
    git("commit", "-m", "init");

    const [appRow] = await harness.db
      .insert(apps)
      .values({
        name: options.name,
        path: appDir,
        needsAppBlueprint: options.needsAppBlueprint ?? false,
      })
      .returning();
    const [chatRow] = await harness.db
      .insert(chats)
      .values({ appId: appRow.id, chatMode: "local-agent" })
      .returning();
    return { appId: appRow.id, chatId: chatRow.id, appDir };
  }

  // sentEvents accumulates for the harness lifetime; baseline per test so an
  // error in one test doesn't also fail every later test in the file.
  let errorEventsBaseline = 0;
  function allErrorEvents() {
    return harness.bridge.sentEvents.filter(
      (e) => e.channel === "chat:response:error",
    );
  }
  function errorEvents() {
    return allErrorEvents().slice(errorEventsBaseline);
  }
  beforeEach(() => {
    errorEventsBaseline = harness ? allErrorEvents().length : 0;
  });

  it("reads a file, edits it, and persists the result", async () => {
    const app = await createMinimalApp({ name: "Read Edit" });
    harness.mount({ chatId: app.chatId, appId: app.appId });

    const { send } = await harness.typeInChat("tc=local-agent/read-then-edit", {
      chatId: app.chatId,
    });
    send();

    await waitFor(
      () =>
        expect(
          screen.getByText(/updated the title from 'Minimal imported app'/i),
        ).toBeTruthy(),
      { timeout: 20_000 },
    );
    await harness.waitForStreamEnd(app.chatId);

    expect(
      fs
        .readFileSync(path.join(app.appDir, "src/App.tsx"), "utf8")
        .replace(/\r\n/g, "\n"),
    ).toBe(
      "const App = () => <div>UPDATED imported app</div>;\n\nexport default App;\n",
    );
    const storedMessages = await harness.db.query.messages.findMany({
      where: eq(messages.chatId, app.chatId),
    });
    expect(storedMessages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(storedMessages.at(-1)?.content).toContain("UPDATED imported app");
    expect(errorEvents()).toHaveLength(0);
  }, 60_000);

  it("applies parallel tool-call file writes", async () => {
    const app = await createMinimalApp({ name: "Parallel Tools" });
    harness.mount({ chatId: app.chatId, appId: app.appId });

    const { send } = await harness.typeInChat("tc=local-agent/parallel-tools", {
      chatId: app.chatId,
    });
    send();

    await harness.waitForStreamEnd(app.chatId);

    expect(
      fs.readFileSync(path.join(app.appDir, "src/utils/math.ts"), "utf8"),
    ).toContain("export function add");
    expect(
      fs.readFileSync(path.join(app.appDir, "src/utils/string.ts"), "utf8"),
    ).toContain("export function capitalize");
    expect(errorEvents()).toHaveLength(0);
  }, 60_000);

  it("submits a planning questionnaire through the real input banner", async () => {
    const app = await createMinimalApp({ name: "Questionnaire" });
    harness.mount({ chatId: app.chatId, appId: app.appId });

    const { send } = await harness.typeInChat("tc=local-agent/questionnaire", {
      chatId: app.chatId,
    });
    send();

    await screen.findByText("Which framework do you prefer?", undefined, {
      timeout: 20_000,
    });
    fireEvent.click(screen.getByText("Vue", { exact: true }));
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));

    await harness.waitForStreamEnd(app.chatId);
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Submit" })).toBeNull(),
    );
    const responseInvoke = harness.bridge.lastInvoke("user-input:respond");
    expect(responseInvoke?.args[0]).toMatchObject({
      response: {
        kind: "questionnaire",
        answers: { framework: "Vue" },
      },
    });
    expect(errorEvents()).toHaveLength(0);
  }, 60_000);

  it("approves an app blueprint and applies its app rename", async () => {
    const app = await createMinimalApp({
      name: "Blueprint Rename",
      needsAppBlueprint: true,
    });
    harness.mount({ chatId: app.chatId, appId: app.appId });

    const { send } = await harness.typeInChat(
      "tc=local-agent/app-blueprint-rename",
      { chatId: app.chatId },
    );
    send();

    await screen.findByRole(
      "button",
      { name: "Approve Plan" },
      { timeout: 20_000 },
    );
    await harness.waitForStreamEnd(app.chatId);
    const followUpEnd = harness.waitForNextStreamEnd(app.chatId);
    const approveButton = await screen.findByRole(
      "button",
      { name: "Approve Plan" },
      { timeout: 20_000 },
    );
    const blueprintApproved = harness.waitForEvent(
      "app-blueprint:approved",
      (payload) =>
        typeof payload === "object" &&
        payload !== null &&
        (payload as { chatId?: number }).chatId === app.chatId,
    );
    fireEvent.click(approveButton);

    await blueprintApproved;
    await waitFor(async () => {
      const appRow = await harness.db.query.apps.findFirst({
        where: eq(apps.id, app.appId),
      });
      expect(appRow?.name).toBe("Lumen Notes");
      expect(appRow?.needsAppBlueprint).toBe(false);
    });
    await followUpEnd;
    expect(errorEvents()).toHaveLength(0);
  }, 60_000);

  it("persists template edits from the app blueprint card", async () => {
    const app = await createMinimalApp({
      name: "Blueprint Template",
      needsAppBlueprint: true,
    });
    harness.mount({ chatId: app.chatId, appId: app.appId });

    // Draft the blueprint through the real streamed path (write_app_blueprint ->
    // app-blueprint:update + <dyad-app-blueprint> assistant message) instead of
    // seeding state + a hand-inserted message + a synthetic bridge send.
    const { send } = await harness.typeInChat(
      "tc=local-agent/app-blueprint-rename",
      { chatId: app.chatId },
    );
    send();

    await screen.findByTestId("app-blueprint-template-select", undefined, {
      timeout: 20_000,
    });
    await harness.waitForStreamEnd(app.chatId);

    // The fixture drafts the blueprint with the "react" template; switching it
    // exercises the edit-field persistence path.
    expect(getAppBlueprintForChat(app.chatId)?.templateId).toBe("react");
    // Re-query the select after the stream settles (post-stream re-renders can
    // replace the node) and wait for the alternate option, which only appears
    // once the official template list loads.
    await waitFor(() =>
      expect(
        (
          screen.getByTestId(
            "app-blueprint-template-select",
          ) as HTMLSelectElement
        ).querySelector('option[value="next"]'),
      ).not.toBeNull(),
    );
    const templateSelect = screen.getByTestId(
      "app-blueprint-template-select",
    ) as HTMLSelectElement;
    fireEvent.change(templateSelect, { target: { value: "next" } });
    await waitFor(() =>
      expect(getAppBlueprintForChat(app.chatId)?.templateId).toBe("next"),
    );
    expect(
      harness.bridge.lastInvoke("app-blueprint:edit-field")?.args[0],
    ).toEqual({ chatId: app.chatId, field: "templateId", value: "next" });
    expect(getAppBlueprintForChat(app.chatId)?.templateId).toBe("next");
    deleteAppBlueprintForChat(app.chatId);
    expect(errorEvents()).toHaveLength(0);
  }, 60_000);
});
