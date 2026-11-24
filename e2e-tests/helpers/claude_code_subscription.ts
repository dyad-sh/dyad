import { expect } from "@playwright/test";
import type { PageObject } from "./page-objects";

/** Point the packaged app at the local Claude billing fixture. */
export async function configureClaudeBilling(
  po: PageObject,
  billingUrl: string,
) {
  await po.electronApp.evaluate((_, url) => {
    process.env.DYAD_ENGINE_URL = url;
    process.env.DYAD_USER_INFO_URL = `http://localhost:${process.env.FAKE_LLM_PORT}/api/user/info`;
  }, billingUrl);
}

/**
 * Real-subscription setup shared by the opt-in Claude Code smoke specs:
 * Pro Agent mode, the Claude Code experiment (and optionally native tools),
 * the minimal app and a Sonnet Claude Code chat. Returns the CLI status.
 */
export async function selectClaudeSubscription(
  po: PageObject,
  billingUrl: string,
  { nativeTools = false }: { nativeTools?: boolean } = {},
) {
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
  if (nativeTools)
    await po.page
      .getByRole("switch", {
        name: "Use native Claude Code tools",
        exact: true,
      })
      .click();
  await po.navigation.goToAppsTab();
  await po.importApp("minimal");
  await configureClaudeBilling(po, billingUrl);
  await po.page.getByTestId("model-picker").click();
  await po.page
    .getByRole("menuitem", {
      name: "Claude Code subscription. Experimental. Open submenu.",
    })
    .hover();
  const useSubscription = po.page.getByRole("menuitemcheckbox", {
    name: "Use Claude subscription",
    exact: true,
  });
  await expect(useSubscription).toBeVisible({ timeout: 30_000 });
  if ((await useSubscription.getAttribute("aria-checked")) !== "true") {
    await useSubscription.click();
  }
  await po.page.keyboard.press("Escape");
  await po.page.keyboard.press("Escape");
  await po.page.getByTestId("model-picker").click();
  await po.page
    .getByRole("menuitem", { name: "All models", exact: true })
    .hover();
  const model = po.page
    .locator('[data-model-provider="claude-code"][data-model-name*="sonnet"]')
    .first();
  await expect(model).toBeEnabled({ timeout: 30_000 });
  await model.click();
  const newChatDialog = po.page.getByRole("dialog");
  await expect(
    newChatDialog.or(
      po.page.getByTestId("model-picker").filter({ hasText: /sonnet/i }),
    ),
  ).toBeVisible();
  if (await newChatDialog.isVisible()) {
    await po.page
      .getByRole("button", { name: "Start new chat", exact: true })
      .click();
  }
  await expect(po.page.getByTestId("model-picker")).toContainText(/sonnet/i);
  return po.page.evaluate(async () => {
    const result = await (window as any).electron.ipcRenderer.invoke(
      "claude-code:status",
    );
    return result.value ?? result;
  });
}
