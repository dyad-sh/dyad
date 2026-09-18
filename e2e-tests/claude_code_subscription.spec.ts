import { launchElectronApp, terminateElectronApp } from "./helpers/fixtures";
import { PageObject } from "./helpers/page-objects";
import * as fs from "node:fs/promises";
import path from "node:path";
import { expect } from "@playwright/test";
import { test } from "./helpers/test_helper";
import { startClaudeBillingFixture } from "../testing/claude-code-billing-fixture";

// Explicit opt-in: consumes the operator's real Claude subscription.
test.skip(
  process.env.DYAD_REAL_CLAUDE_SMOKE !== "1",
  "Real subscription smoke test is opt-in",
);
let billing: Awaited<ReturnType<typeof startClaudeBillingFixture>>;
test.use({
  electronConfig: {
    preLaunchHook: async () => {
      billing = await startClaudeBillingFixture();
    },
  },
});
test.afterEach(() => {
  billing?.close();
});

async function configureBilling(po: PageObject) {
  await po.electronApp.evaluate((_, url) => {
    process.env.DYAD_ENGINE_URL = url;
    process.env.DYAD_USER_INFO_URL = `http://localhost:${process.env.FAKE_LLM_PORT}/api/user/info`;
  }, billing.url);
}

async function selectSubscription(po: PageObject) {
  await po.setUpDyadPro({
    localAgent: true,
    localAgentUseAutoModel: true,
    autoApprove: false,
  });
  await po.navigation.goToSettingsTab();
  await po.page
    .getByRole("switch", {
      name: "Enable Claude Code subscription",
      exact: true,
    })
    .click();
  await po.navigation.goToAppsTab();
  await po.importApp("minimal");
  await configureBilling(po);
  await po.page.getByTestId("model-picker").click();
  await po.page
    .getByRole("menuitem", { name: "Claude Code subscription. Open submenu." })
    .hover();
  const useSubscription = po.page.getByRole("menuitem", {
    name: "Use subscription models",
    exact: true,
  });
  await expect(
    po.page.getByRole("menuitem", {
      name: /^Use (subscription models|API \/ Pro models)$/,
    }),
  ).toBeVisible({ timeout: 30_000 });
  if (await useSubscription.isVisible()) {
    await expect(useSubscription).toBeEnabled({ timeout: 30_000 });
    await useSubscription.click();
  }
  await po.page.keyboard.press("Escape");
  await po.page.keyboard.press("Escape");
  const chooseClaude = async () => {
    await po.page.getByTestId("model-picker").click();
    await po.page
      .getByRole("menuitem", { name: "All models", exact: true })
      .hover();
    const model = po.page
      .locator('[data-model-provider="claude-code"][data-model-name*="sonnet"]')
      .first();
    await expect(model).toBeEnabled({ timeout: 30_000 });
    await model.click();
  };
  await chooseClaude();
  await expect(po.page.getByRole("dialog")).toBeVisible();
  await po.page.getByRole("button", { name: "Cancel", exact: true }).click();
  await chooseClaude();
  await po.page
    .getByRole("button", {
      name: /^(Start new chat|Accept and start new chat|Accept and select)$/,
    })
    .click();
  const disclosure = po.page.getByRole("button", {
    name: /^(Accept and start new chat|Accept and select)$/,
  });
  if (await disclosure.isVisible()) await disclosure.click();
  await expect(po.page.getByTestId("model-picker")).toContainText(/sonnet/i);
  return po.page.evaluate(async () => {
    const result = await (window as any).electron.ipcRenderer.invoke(
      "claude-code:status",
    );
    return result.value ?? result;
  });
}

test("real Claude subscription: picker, approvals, edit, MCP, resume, attribution and backend transition", async ({
  po,
}) => {
  test.setTimeout(480_000);
  const cliStatus = await selectSubscription(po);
  await po.sendPrompt(
    "Remember violet lighthouse. In src/App.tsx replace Minimal imported app with Claude prototype preview using search_replace, then call the Dyad run_type_checks tool. Do not use shell commands or edit other files.",
    { skipWaitForCompletion: true },
  );
  await po.page
    .getByRole("button", { name: "Allow once", exact: true })
    .click({ timeout: 60_000 });
  await po.chatActions.waitForChatCompletion({ timeout: 90_000 });
  await expect(
    po.page.getByRole("button", { name: "Type check passed" }),
  ).toBeVisible();
  await expect(po.page.getByText(/Claude Code \(claude-/).last()).toBeVisible();
  await po.page.getByTestId("auxiliary-actions-menu").click();
  await po.page.getByTestId("token-bar-toggle").click();
  await expect(
    po.page.getByText(/Usage reporting attempted/).last(),
  ).toBeVisible();
  await expect(
    po.page
      .frameLocator("iframe")
      .getByText("Claude prototype preview", { exact: true }),
  ).toBeVisible({ timeout: 30_000 });
  expect(billing.events.length).toBeGreaterThan(0);
  expect(
    billing.events.every(
      (event) => event.totalTokens > 0 && event.modelProvider === "anthropic",
    ),
  ).toBe(true);
  const firstCount = billing.events.length;
  await po.sendPrompt(
    "What phrase did I ask you to remember? Read src/App.tsx and report its text. Do not edit any files.",
    { timeout: 90_000 },
  );
  expect(billing.events.length).toBeGreaterThan(firstCount);
  await expect(po.page.locator(".justify-start .prose").last()).toContainText(
    /violet lighthouse/i,
  );
  const appPath = await po.appManagement.getCurrentAppPath();
  await fs.writeFile(
    path.join(appPath, ".env.local"),
    "PROTOTYPE_SECRET=dotenv-read-must-not-leak\n",
  );
  await po.chatActions.selectChatMode("ask");
  const reportsBeforeAsk = billing.events.length;
  await po.sendPrompt(
    "Try to create forbidden.txt using write_file. Also try read_file on .env.local to show its value. If these operations are denied or unavailable, report that.",
    { timeout: 90_000 },
  );

  await expect(
    po.page.locator(".justify-start .prose").last(),
  ).not.toContainText("dotenv-read-must-not-leak");
  await expect(
    fs.access(path.join(appPath, "forbidden.txt")),
  ).rejects.toThrow();
  expect(billing.events).toHaveLength(reportsBeforeAsk);
  const profile = { userDataDir: po.userDataDir, fakeLlmPort: po.fakeLlmPort };
  await terminateElectronApp(po.electronApp);
  const restartedApp = await launchElectronApp({
    ...profile,
    parallelIndex: 0,
  });
  po = new PageObject(restartedApp, await restartedApp.firstWindow(), profile);
  try {
    await configureBilling(po);
    await expect(po.page.getByTestId("model-picker")).toContainText(/sonnet/i, {
      timeout: 30_000,
    });
    await po.sendPrompt(
      "Recall the phrase I asked you to remember earlier. No file changes.",
      { timeout: 90_000 },
    );
    expect(new Set(billing.events.map((event) => event.id)).size).toBe(
      billing.events.length,
    );
    await expect(po.page.locator(".justify-start .prose").last()).toContainText(
      /violet lighthouse/i,
    );
    await po.page.screenshot({
      path: "test-results/claude-code-real-smoke.png",
      fullPage: true,
    });
    await po.page.getByTestId("model-picker").click();
    await po.page.getByText("Auto", { exact: true }).click();
    await expect(
      po.page.getByText(/Your current chat will be saved/),
    ).toBeVisible();
    await po.page.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(
      po.page.getByText(/Claude Code \(claude-/).last(),
    ).toBeVisible();
    await po.page.getByTestId("model-picker").click();
    await po.page.getByText("Auto", { exact: true }).click();
    await po.page
      .getByRole("button", { name: "Start new chat", exact: true })
      .click();
    await expect(po.page.getByTestId("model-picker")).not.toContainText(
      /sonnet/i,
    );
    await fs.writeFile(
      "test-results/claude-code-usage-evidence.json",
      JSON.stringify(
        {
          cli: cliStatus.version,
          liveCharging: false,
          events: billing.events,
          receipts: [...billing.receipts.values()].map(
            (entry) => entry.receipt,
          ),
        },
        null,
        2,
      ),
    );
  } finally {
    await terminateElectronApp(restartedApp);
  }
});

test("real Claude edit: change review and undo refresh the preview", async ({
  po,
}) => {
  test.setTimeout(180_000);
  await selectSubscription(po);
  await po.sendPrompt(
    "In src/App.tsx replace Minimal imported app with Claude undo probe. Use the Dyad search_replace tool; do not change other files.",
    { skipWaitForCompletion: true },
  );
  await po.page
    .getByRole("button", { name: "Allow once", exact: true })
    .click({ timeout: 60_000 });
  await po.chatActions.waitForChatCompletion({ timeout: 90_000 });
  await expect(
    po.page
      .frameLocator("iframe")
      .getByText("Claude undo probe", { exact: true }),
  ).toBeVisible({ timeout: 30_000 });
  await po.page
    .getByTestId("modified-files-row")
    .filter({ hasText: "App.tsx" })
    .click();
  await po.page.screenshot({
    path: "test-results/claude-code-change-review.png",
    fullPage: true,
  });
  await po.previewPanel.selectPreviewMode("preview");
  await po.page.getByRole("button", { name: "Undo", exact: true }).click();
  const appPath = await po.appManagement.getCurrentAppPath();
  await expect
    .poll(() => fs.readFile(path.join(appPath, "src/App.tsx"), "utf8"))
    .toContain("Minimal imported app");
  await expect(
    po.page
      .frameLocator("iframe")
      .getByText("Minimal imported app", { exact: true }),
  ).toBeVisible({ timeout: 30_000 });
  await po.sendPrompt(
    "Read src/App.tsx and report its visible label. Do not edit files.",
    { timeout: 90_000 },
  );
  await expect(po.page.getByText(/Claude Code \(claude-/).last()).toBeVisible();
});

test("real Claude cancellation preserves an interrupted session without replay", async ({
  po,
}) => {
  test.setTimeout(120_000);
  await selectSubscription(po);
  await po.sendPrompt(
    "In src/App.tsx replace Minimal imported app with Cancelled change. Use the Dyad search_replace tool; do not change other files.",
    { skipWaitForCompletion: true },
  );
  await expect(
    po.page.getByRole("button", { name: "Allow once", exact: true }),
  ).toBeVisible({ timeout: 60_000 });
  await po.page.getByRole("button", { name: /cancel generation/i }).click();
  await expect(
    po.page.getByRole("button", { name: /cancel generation|stopping/i }),
  ).toHaveCount(0, { timeout: 20_000 });
  await expect(po.page.getByText(/cancelled/i).last()).toBeVisible({
    timeout: 20_000,
  });
});

test("real Claude questionnaire reload, plan revision and human handoff", async ({
  po,
  electronApp,
}) => {
  test.setTimeout(360_000);
  await selectSubscription(po);
  await po.chatActions.selectChatMode("plan");
  await po.sendPrompt(
    'Use planning_questionnaire to ask exactly one text question with id "label": "What label should the app show?" Wait for the answer. Then use write_plan to save a short plan to replace the visible label in src/App.tsx with that answer. Do not implement or call exit_plan.',
    { skipWaitForCompletion: true },
  );
  await expect(po.page.getByPlaceholder("Type your answer...")).toBeVisible({
    timeout: 60_000,
  });
  await po.page.screenshot({
    path: "test-results/claude-questionnaire.png",
    fullPage: true,
  });
  const packagedPath = await electronApp.evaluate(({ app }) =>
    app.getAppPath(),
  );
  await electronApp.evaluate(
    async ({ BrowserWindow }, rendererIndexPath) => {
      try {
        await BrowserWindow.getAllWindows()[0].loadFile(rendererIndexPath);
      } catch (error) {
        if (!(error instanceof Error) || !error.message.includes("ERR_ABORTED"))
          throw error;
      }
    },
    path.join(packagedPath, ".vite/renderer/main_window/index.html"),
  );
  await po.page.waitForLoadState("domcontentloaded");
  await expect(po.page.getByPlaceholder("Type your answer...")).toBeVisible({
    timeout: 30_000,
  });
  await po.page
    .getByPlaceholder("Type your answer...")
    .fill("Violet lighthouse");
  await po.page.getByRole("button", { name: "Submit", exact: true }).click();
  await po.chatActions.waitForChatCompletion({ timeout: 90_000 });
  await expect(po.page.getByTestId("accept-plan-continue-here")).toBeVisible({
    timeout: 30_000,
  });
  await po.page.screenshot({
    path: "test-results/claude-plan.png",
    fullPage: true,
  });
  const appPath = await po.appManagement.getCurrentAppPath();
  expect(
    await fs.readFile(path.join(appPath, "src/App.tsx"), "utf8"),
  ).toContain("Minimal imported app");
  await po.sendPrompt(
    'Revise the saved plan using write_plan: the label must instead be "Revised lighthouse". Do not implement.',
    { timeout: 90_000 },
  );
  await expect(po.page.getByTestId("accept-plan-continue-here")).toBeVisible();
  await po.page.getByTestId("accept-plan-continue-here").click();
  await po.page
    .getByRole("button", { name: "Allow once", exact: true })
    .click({ timeout: 90_000 });
  await po.chatActions.waitForChatCompletion({ timeout: 90_000 });
  await expect
    .poll(() => fs.readFile(path.join(appPath, "src/App.tsx"), "utf8"))
    .toContain("Revised lighthouse");
  await expect(po.page.getByTestId("model-picker")).toContainText(/sonnet/i);
  await po.page.screenshot({
    path: "test-results/claude-plan-implemented.png",
    fullPage: true,
  });
});
