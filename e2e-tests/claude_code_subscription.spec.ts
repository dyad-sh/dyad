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
      process.env.DYAD_CLAUDE_BILLING_URL = billing.url;
    },
  },
});
test.afterEach(() => {
  billing?.close();
  delete process.env.DYAD_CLAUDE_BILLING_URL;
});

async function selectSubscription(po: PageObject) {
  await po.importApp("minimal");
  await po.page.getByTestId("model-picker").click();
  await expect(
    po.page.getByRole("menuitem", {
      name: "Claude Code — sonnet",
      exact: true,
    }),
  ).toBeEnabled({ timeout: 20_000 });
  await po.page
    .getByRole("menuitem", { name: "Claude Code — sonnet", exact: true })
    .click();
  await expect(
    po.page.getByText(
      "Switching backends requires a new chat. Your current chat will stay unchanged.",
    ),
  ).toBeVisible();
  await po.page.getByRole("button", { name: "Cancel", exact: true }).click();
  await po.page.getByTestId("model-picker").click();
  await po.page
    .getByRole("menuitem", { name: "Claude Code — sonnet", exact: true })
    .click();
  await po.page
    .getByRole("button", { name: "Start new chat", exact: true })
    .click();
  await expect(po.page.getByTestId("model-picker")).toContainText("sonnet");
  return po.page.evaluate(() =>
    (window as any).electron.ipcRenderer.invoke("claude-code:status"),
  );
}

test("real Claude subscription: picker, approvals, edit, MCP, resume, attribution and backend transition", async ({
  po,
}) => {
  test.setTimeout(480_000);
  const cliStatus = await selectSubscription(po);
  await po.sendPrompt(
    "Remember violet lighthouse. In src/App.tsx replace Minimal imported app with Claude prototype preview using Edit, then call the dyad diagnostics and type_check MCP tools. Do not use shell commands or edit other files.",
    { skipWaitForCompletion: true },
  );
  await po.page
    .getByRole("button", { name: "Allow once", exact: true })
    .click({ timeout: 60_000 });
  await po.page
    .getByRole("button", { name: "Allow once", exact: true })
    .click({ timeout: 60_000 });
  await po.chatActions.waitForChatCompletion({ timeout: 90_000 });
  await expect(po.page.getByText(/Claude Code \(claude-/).last()).toBeVisible();
  await expect(
    po.page.getByText(/Test accounting — no live Dyad charge/).last(),
  ).toBeVisible();
  await expect(
    po.page
      .frameLocator("iframe")
      .getByText("Claude prototype preview", { exact: true }),
  ).toBeVisible({ timeout: 30_000 });
  expect(billing.events).toHaveLength(1);
  expect(billing.events[0].coverage).toBe("complete");
  expect(billing.events[0].models.length).toBeGreaterThan(0);
  await po.sendPrompt(
    "What phrase did I ask you to remember? Read src/App.tsx and report its text. Do not edit any files.",
    { timeout: 90_000 },
  );
  expect(billing.events).toHaveLength(2);
  expect(billing.events[1].sessionId).toBe(billing.events[0].sessionId);
  await expect(po.page.getByText(/violet lighthouse/).last()).toBeVisible();
  await po.chatActions.selectChatMode("ask");
  await po.sendPrompt(
    "Use Bash or Write to create forbidden.txt. Do not substitute tools. If these tools are unavailable, report that.",
    { timeout: 90_000 },
  );
  expect(billing.events).toHaveLength(3);
  const appPath = await po.appManagement.getCurrentAppPath();
  await expect(
    fs.access(path.join(appPath, "forbidden.txt")),
  ).rejects.toThrow();
  const profile = { userDataDir: po.userDataDir, fakeLlmPort: po.fakeLlmPort };
  await terminateElectronApp(po.electronApp);
  const restartedApp = await launchElectronApp({
    ...profile,
    parallelIndex: 0,
  });
  po = new PageObject(restartedApp, await restartedApp.firstWindow(), profile);
  try {
    await expect(po.page.getByTestId("model-picker")).toContainText("sonnet", {
      timeout: 30_000,
    });
    await po.sendPrompt(
      "Recall the phrase I asked you to remember earlier. No file changes.",
      { timeout: 90_000 },
    );
    expect(billing.events).toHaveLength(4);
    expect(billing.events[3].sessionId).toBe(billing.events[0].sessionId);
    await expect(po.page.getByText(/violet lighthouse/).last()).toBeVisible();
    await po.page.screenshot({
      path: "test-results/claude-code-real-smoke.png",
      fullPage: true,
    });
    await po.page.getByTestId("model-picker").click();
    await po.page.getByText("Auto", { exact: true }).click();
    await expect(
      po.page.getByText(
        "Switching backends requires a new chat. Your current chat will stay unchanged.",
      ),
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
      "sonnet",
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
    "In src/App.tsx replace Minimal imported app with Claude undo probe. Use Edit only; do not change other files.",
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
});

test("real Claude cancellation preserves an interrupted session without replay", async ({
  po,
}) => {
  test.setTimeout(120_000);
  await selectSubscription(po);
  await po.sendPrompt(
    "Write a very long explanation of React rendering, at least 10000 words. Start with the exact text CANCELLATION PROBE START. Do not use tools.",
    { skipWaitForCompletion: true },
  );
  await expect(
    po.page
      .locator(".justify-start .prose")
      .filter({ hasText: "CANCELLATION PROBE START" })
      .last(),
  ).toBeVisible({ timeout: 60_000 });
  await po.page.getByRole("button", { name: /cancel generation/i }).click();
  await expect(
    po.page.getByRole("button", { name: /cancel generation|stopping/i }),
  ).toHaveCount(0, { timeout: 20_000 });
  await expect(
    po.page.getByText(/Claude Code was interrupted or failed/).last(),
  ).toBeVisible({ timeout: 20_000 });
});
