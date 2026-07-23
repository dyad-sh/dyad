import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { fireEvent, screen, waitFor } from "@testing-library/react";
import { eq } from "drizzle-orm";

import { apps, chats } from "@/db/schema";
import type { PlanUpdatePayload } from "@/ipc/types/plan";
import {
  setupHybridChatHarness,
  type HybridChatHarness,
} from "@/testing/hybrid_chat_harness";
import { h } from "@/testing/hybrid.setup";

// Expected plan values produced by the `local-agent/accept-plan` fixture's
// `write_plan` tool call, which every plan test below streams to drive the real
// `plan:update` emission. Typed against the production `PlanUpdatePayload`
// contract so a drift in the emitted shape fails to compile here.
const EXPECTED_PLAN: Omit<PlanUpdatePayload, "chatId"> = {
  title: "Test Plan",
  summary: "A test implementation plan for E2E testing.",
  plan: "## Overview\n\nThis is a test plan.\n\n## Steps\n\n1. Step one\n2. Step two",
};

describe("plan mode (integration)", () => {
  let harness: HybridChatHarness;
  let appCounter = 0;

  beforeAll(async () => {
    harness = await setupHybridChatHarness({
      electronMock: h,
      engine: true,
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

  async function createMinimalApp(name: string, chatMode: "plan" | null) {
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
      `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${appCounter}`,
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
    git("add", "-A");
    git("commit", "-m", "init");

    const [appRow] = await harness.db
      .insert(apps)
      .values({ name, path: appDir })
      .returning();
    const [chatRow] = await harness.db
      .insert(chats)
      .values({ appId: appRow.id, chatMode })
      .returning();
    return { appId: appRow.id, chatId: chatRow.id, appDir };
  }

  // Stream the `local-agent/accept-plan` fixture, which issues a real
  // `write_plan` tool call. That drives the production emission path
  // (`writePlanTool` -> `plan:update`) so the plan panel is populated by the
  // real payload rather than a synthetic bridge send. Returns after the turn
  // that presents the plan has fully streamed.
  async function streamRealPlan(chatId: number) {
    const { send } = await harness.typeInChat("tc=local-agent/accept-plan", {
      chatId,
    });
    send();
    const event = await harness.waitForEvent(
      "plan:update",
      (payload) =>
        typeof payload === "object" &&
        payload !== null &&
        (payload as PlanUpdatePayload).chatId === chatId,
      30_000,
    );
    await harness.waitForStreamEnd(chatId);
    return event.payload as PlanUpdatePayload;
  }

  async function waitForChatSurface() {
    await screen.findByTestId("chat-input-container", undefined, {
      timeout: 15_000,
    });
  }

  async function waitForPlanFile(appDir: string) {
    const planDir = path.join(appDir, ".dyad", "plans");
    await waitFor(() => {
      const mdFiles = fs.readdirSync(planDir).filter((f) => f.endsWith(".md"));
      expect(mdFiles.length).toBeGreaterThan(0);
      const planContent = fs.readFileSync(
        path.join(planDir, mdFiles[0]),
        "utf-8",
      );
      expect(planContent).toContain(EXPECTED_PLAN.title);
    });
  }

  function errorEvents() {
    return harness.bridge.sentEvents.filter(
      (e) => e.channel === "chat:response:error",
    );
  }

  it("switches to plan mode through the chat mode selector", async () => {
    const app = await createMinimalApp("Plan Selector", null);
    harness.mount({ chatId: app.chatId, appId: app.appId });

    await harness.selectChatMode("plan");

    const chatRow = await harness.db.query.chats.findFirst({
      where: eq(chats.id, app.chatId),
    });
    expect(chatRow?.chatMode).toBe("plan");
    expect(
      screen.getByTestId("chat-mode-selector").getAttribute("aria-label"),
    ).toBe("Chat mode: Plan");
    expect(errorEvents()).toHaveLength(0);
  }, 60_000);

  it("accepts a plan and starts implementation in a new chat", async () => {
    const app = await createMinimalApp("Plan New Chat", "plan");
    harness.mount({
      chatId: app.chatId,
      appId: app.appId,
      withPlanPanel: true,
    });
    await waitForChatSurface();
    // Drive the real streamed plan-generation path instead of a synthetic
    // bridge send: the plan panel below is populated by the production
    // `write_plan` -> `plan:update` emission.
    const planUpdate = await streamRealPlan(app.chatId);
    expect(planUpdate).toMatchObject({
      chatId: app.chatId,
      title: EXPECTED_PLAN.title,
    });

    const acceptButton = await screen.findByTestId("accept-plan-new-chat");
    fireEvent.click(acceptButton);

    await harness.waitForEvent(
      "plan:exit",
      (payload) =>
        typeof payload === "object" &&
        payload !== null &&
        (payload as { chatId?: number }).chatId === app.chatId,
      30_000,
    );
    await waitFor(
      () => {
        const location = harness.currentLocation();
        expect(Number(location.search.id)).toBeGreaterThan(0);
        expect(Number(location.search.id)).not.toBe(app.chatId);
        expect(Number(location.search.appId)).toBe(app.appId);
      },
      { timeout: 30_000 },
    );
    await waitForPlanFile(app.appDir);
    expect(errorEvents()).toHaveLength(0);
  }, 60_000);

  it("accepts a plan and continues implementation in the same chat", async () => {
    const app = await createMinimalApp("Plan Continue", "plan");
    harness.mount({
      chatId: app.chatId,
      appId: app.appId,
      withPlanPanel: true,
    });
    await waitForChatSurface();
    await streamRealPlan(app.chatId);

    fireEvent.click(await screen.findByTestId("accept-plan-continue-here"));

    await harness.waitForEvent(
      "plan:exit",
      (payload) =>
        typeof payload === "object" &&
        payload !== null &&
        (payload as { chatId?: number }).chatId === app.chatId,
      30_000,
    );
    await waitFor(
      async () => {
        const location = harness.currentLocation();
        expect(Number(location.search.id)).toBe(app.chatId);
        const chatRow = await harness.db.query.chats.findFirst({
          where: eq(chats.id, app.chatId),
        });
        expect(chatRow?.chatMode).toBe("local-agent");
      },
      { timeout: 30_000 },
    );
    await waitForPlanFile(app.appDir);
    expect(errorEvents()).toHaveLength(0);
  }, 60_000);

  it("defaults typed plan acceptance to the current chat", async () => {
    const app = await createMinimalApp("Plan Typed Accept", "plan");
    harness.mount({
      chatId: app.chatId,
      appId: app.appId,
      withPlanPanel: true,
    });
    await waitForChatSurface();

    // Simulate this chat having previously accepted a plan with the explicit
    // "new chat" button. The next plan update must clear that stale choice.
    harness.setPlanAcceptInNewChat(app.chatId, true);
    await streamRealPlan(app.chatId);
    expect(harness.getPlanAcceptInNewChat(app.chatId)).toBeUndefined();

    // Free-text acceptance does not record a new choice. Routing must still
    // continue here instead of reusing the stale choice and creating a chat.
    const { send } = await harness.typeInChat(
      "I accept this plan. Call the exit_plan tool now with confirmation: true to begin implementation.",
      { chatId: app.chatId },
    );
    send();

    await harness.waitForEvent(
      "plan:exit",
      (payload) =>
        typeof payload === "object" &&
        payload !== null &&
        (payload as { chatId?: number }).chatId === app.chatId,
      30_000,
    );
    await waitFor(
      async () => {
        const location = harness.currentLocation();
        expect(Number(location.search.id)).toBe(app.chatId);
        const chatRow = await harness.db.query.chats.findFirst({
          where: eq(chats.id, app.chatId),
        });
        expect(chatRow?.chatMode).toBe("local-agent");
      },
      { timeout: 30_000 },
    );
    await waitForPlanFile(app.appDir);
    expect(errorEvents()).toHaveLength(0);
  }, 60_000);

  it("uses the source app when accepting from a stale selected app", async () => {
    const source = await createMinimalApp("Plan Source", "plan");
    const stale = await createMinimalApp("Plan Stale Selection", null);
    harness.mount({
      chatId: source.chatId,
      appId: source.appId,
      withPlanPanel: true,
    });
    await waitForChatSurface();
    harness.setSelectedAppId(stale.appId);
    await streamRealPlan(source.chatId);

    fireEvent.click(await screen.findByTestId("accept-plan-new-chat"));

    await harness.waitForEvent(
      "plan:exit",
      (payload) =>
        typeof payload === "object" &&
        payload !== null &&
        (payload as { chatId?: number }).chatId === source.chatId,
      30_000,
    );
    let implementationChatId = 0;
    await waitFor(
      () => {
        const location = harness.currentLocation();
        implementationChatId = Number(location.search.id);
        expect(implementationChatId).toBeGreaterThan(0);
        expect(implementationChatId).not.toBe(source.chatId);
        expect(Number(location.search.appId)).toBe(source.appId);
      },
      { timeout: 30_000 },
    );
    const implementationChat = await harness.db.query.chats.findFirst({
      where: eq(chats.id, implementationChatId),
    });
    expect(implementationChat?.appId).toBe(source.appId);
    expect(implementationChat?.appId).not.toBe(stale.appId);
    await waitForPlanFile(source.appDir);
    const stalePlanDir = path.join(stale.appDir, ".dyad", "plans");
    const stalePlanFiles = fs.existsSync(stalePlanDir)
      ? fs.readdirSync(stalePlanDir).filter((f) => f.endsWith(".md"))
      : [];
    expect(stalePlanFiles).toHaveLength(0);
    expect(errorEvents()).toHaveLength(0);
  }, 60_000);

  it("submits a planning questionnaire while in plan mode", async () => {
    const app = await createMinimalApp("Plan Questionnaire", "plan");
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

    expect(
      harness.bridge.lastInvoke("user-input:respond")?.args[0],
    ).toMatchObject({
      response: {
        kind: "questionnaire",
        answers: { framework: "Vue" },
      },
    });
    expect(errorEvents()).toHaveLength(0);
  }, 60_000);
});
