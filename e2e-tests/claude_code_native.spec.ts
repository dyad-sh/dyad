import * as fs from "node:fs/promises";
import path from "node:path";
import { expect } from "@playwright/test";
import { test } from "./helpers/test_helper";
import { startClaudeBillingFixture } from "../testing/claude-code-billing-fixture";
import { selectClaudeSubscription } from "./helpers/claude_code_subscription";

// Explicit opt-in: consumes the operator's real Claude subscription and runs
// Claude Code's own tools (including Bash) against a disposable app.
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

test("real Claude subscription with native tools: Bash, Edit, cards, preview, commit and session memory", async ({
  po,
}) => {
  test.setTimeout(480_000);
  await selectClaudeSubscription(po, billing.url, { nativeTools: true });
  await po.sendPrompt(
    "Use your Bash tool to run exactly: echo native-e2e > native-e2e.txt\nThen use your Edit tool to replace the text Minimal imported app with Native harness preview in src/App.tsx. Do not edit other files. Reply with the single word done.",
    { timeout: 180_000 },
  );
  const lastResponse = po.page.locator(".justify-start").last();
  // Native tool calls show as Dyad cards in the response.
  await expect(lastResponse.getByText(/^Ran /).first()).toBeVisible();
  await expect(
    po.page
      .frameLocator("iframe")
      .getByText("Native harness preview", { exact: true }),
  ).toBeVisible({ timeout: 60_000 });
  const appPath = await po.appManagement.getCurrentAppPath();
  expect(
    (await fs.readFile(path.join(appPath, "native-e2e.txt"), "utf8")).trim(),
  ).toBe("native-e2e");
  await expect(po.page.getByText(/Claude Code \(claude-/).last()).toBeVisible();

  // The next turn resumes the same Claude Code session.
  await po.sendPrompt(
    "Without using any tools: what exact text did your Bash command write, and to which file? Answer in one short sentence.",
    { timeout: 120_000 },
  );
  await expect(po.page.locator(".justify-start .prose").last()).toContainText(
    /native-e2e\.txt/,
  );
  await po.page.screenshot({
    path: "test-results/claude-code-native-smoke.png",
    fullPage: true,
  });
});
