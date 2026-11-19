import { expect } from "@playwright/test";
import path from "path";

import type { PageObject } from "./helpers/page-objects";
import { testSkipIfWindows } from "./helpers/test_helper";

const TEST_MCP_SERVER_PATH = path.join(
  __dirname,
  "..",
  "testing",
  "fake-stdio-mcp-server.mjs",
);

async function setSettings(po: PageObject, settings: Record<string, unknown>) {
  await po.page.evaluate(async (values) => {
    await (window as any).electron.ipcRenderer.invoke(
      "set-user-settings",
      values,
    );
  }, settings);
}

async function addCalculatorPlugin(po: PageObject) {
  await po.navigation.goToPluginsTab();
  await po.plugins.openAddPluginDialog();
  await po.page
    .getByRole("textbox", { name: "My MCP Server" })
    .fill("testing-mcp-server");
  await po.page.getByRole("textbox", { name: "node" }).fill("node");
  await po.page
    .getByRole("textbox", { name: "path/to/mcp-server.js --flag" })
    .fill(TEST_MCP_SERVER_PATH);
  await po.plugins.submitAddPluginDialog();
  await expect(po.page.getByTestId("plugin-detail")).toBeVisible();
  await po.plugins.waitForToolInDetail("calculator_add");
}

testSkipIfWindows(
  "mcp app-scoped - an app uses its own plugin configuration",
  async ({ po }) => {
    await po.setUpDyadPro({ localAgent: true });
    // This scenario exercises manual consent, not safe-tool auto-approval.
    await setSettings(po, { autoApproveSafeMcpTools: false });
    await expect
      .poll(() => po.settings.recordSettings().autoApproveSafeMcpTools)
      .toBe(false);

    // Through the Settings page, so the renderer's settings pick it up.
    await po.navigation.goToSettingsTab();
    await po.page.getByRole("button", { name: "Experiments" }).click();
    await po.page
      .getByRole("switch", {
        name: "Enable app-specific plugin configurations",
      })
      .click();
    await expect
      .poll(() => po.settings.recordSettings().enableAppScopedPlugins)
      .toBe(true);

    // The app has to exist before a configuration can be assigned to it.
    await po.navigation.goToAppsTab();
    await po.sendPrompt("tc=basic");
    const appName = await po.appManagement.getCurrentAppName();

    await addCalculatorPlugin(po);
    const detail = po.page.getByTestId("plugin-detail");

    // The default serves no app, so only the app-specific configuration
    // can give this app the plugin.
    await detail
      .getByRole("combobox", {
        name: "Apps that use the default configuration",
      })
      .click();
    await po.page.getByRole("option", { name: "No apps" }).click();
    await expect(
      detail.getByText(
        "Not used: apps without their own configuration won't have testing-mcp-server.",
      ),
    ).toBeVisible();

    const appConfigs = po.page.getByTestId("plugin-app-configs");
    await appConfigs.getByRole("button", { name: "Add configuration" }).click();
    const dialog = po.page.getByRole("dialog");
    await dialog.getByLabel("Name").fill("Lab");
    await dialog.getByRole("checkbox", { name: appName! }).click();
    await dialog.getByRole("button", { name: "Create" }).click();
    await expect(appConfigs.getByText(`Used by: ${appName}`)).toBeVisible();

    await po.navigation.goToChatTab();
    await po.chatActions.selectChatMode("local-agent");
    await po.sendPrompt("tc=local-agent/mcp-calculator", {
      skipWaitForCompletion: true,
    });
    await po.agentConsent.waitForAgentConsentBanner();
    await po.agentConsent.clickAgentConsentAlwaysAllow();
    await po.chatActions.waitForChatCompletion();

    await expect(po.page.getByText(/The sum of 5 and 3 is 8/)).toBeVisible();
    // The tool card names the configuration that ran the tool.
    await expect(
      po.page.getByText("testing-mcp-server (Lab)").first(),
    ).toBeVisible();
  },
);

testSkipIfWindows(
  "mcp app-scoped - the plugin page is unchanged with the experiment off",
  async ({ po }) => {
    await po.setUpDyadPro({ localAgent: true });
    await addCalculatorPlugin(po);

    await expect(
      po.page.getByRole("heading", { name: "Default configuration" }),
    ).toHaveCount(0);
    await expect(po.page.getByTestId("plugin-app-configs")).toHaveCount(0);
  },
);
