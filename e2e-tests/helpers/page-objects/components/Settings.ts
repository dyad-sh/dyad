/**
 * Page object for settings functionality.
 * Handles toggles, settings recording, and provider configuration.
 */

import { Page, expect } from "@playwright/test";
import fs from "fs";
import path from "path";

export class Settings {
  constructor(
    public page: Page,
    private userDataDir: string,
    private fakeLlmPort: number,
  ) {}

  async toggleAutoApprove() {
    await this.page.getByRole("switch", { name: "Auto-approve" }).click();
  }

  async toggleLocalAgentMode() {
    await this.page.getByRole("switch", { name: "Enable Agent v2" }).click();
  }

  async toggleNativeGit() {
    await this.page.getByRole("switch", { name: "Enable Native Git" }).click();
  }

  async toggleAutoFixProblems() {
    await this.page.getByRole("switch", { name: "Auto-fix problems" }).click();
  }

  async toggleEnableMcpServersForBuildMode() {
    await this.page
      .getByRole("switch", { name: "Enable MCP servers for Build mode" })
      .click();
  }

  async toggleAutoUpdate() {
    await this.page.getByRole("switch", { name: "Auto-update" }).click();
  }

  async toggleExploreSubAgent() {
    // Scroll to AI Settings section first to ensure the switch is in view
    await this.page
      .locator('[id="setting-explore-sub-agent"]')
      .scrollIntoViewIfNeeded();
    const switchElement = this.page.getByRole("switch", {
      name: "Explore sub-agent",
    });
    await switchElement.click();
  }

  async changeReleaseChannel(channel: "stable" | "beta") {
    await this.page.getByRole("combobox", { name: "Release Channel" }).click();
    await this.page
      .getByRole("option", { name: channel === "stable" ? "Stable" : "Beta" })
      .click();
  }

  async clickTelemetryAccept() {
    await this.page.getByTestId("telemetry-accept-button").click();
  }

  async clickTelemetryReject() {
    await this.page.getByTestId("telemetry-reject-button").click();
  }

  async clickTelemetryLater() {
    await this.page.getByTestId("telemetry-later-button").click();
  }

  /**
   * Records the current settings state for later comparison.
   * Use with `snapshotSettingsDelta()` to snapshot only what changed.
   */
  recordSettings(): Record<string, unknown> {
    const settingsPath = path.join(this.userDataDir, "user-settings.json");
    const settingsContent = fs.readFileSync(settingsPath, "utf-8");
    return JSON.parse(settingsContent);
  }

  /**
   * Snapshots only the differences between the current settings and a previously recorded state.
   * Output is in git diff style for easy reading.
   */
  snapshotSettingsDelta(beforeSettings: Record<string, unknown>) {
    const afterSettings = this.recordSettings();

    const diffLines: string[] = [];

    const allKeys = new Set([
      ...Object.keys(beforeSettings),
      ...Object.keys(afterSettings),
    ]);

    // Sort keys for deterministic output
    const sortedKeys = Array.from(allKeys).sort();

    // Keys whose values should be redacted for deterministic snapshots
    const redactedKeys: Record<string, string> = {
      telemetryUserId: "[UUID]",
      lastShownReleaseNotesVersion: "[scrubbed]",
    };

    for (const key of sortedKeys) {
      const beforeValue = beforeSettings[key];
      const afterValue = afterSettings[key];
      const beforeExists = key in beforeSettings;
      const afterExists = key in afterSettings;

      // Format value with diff marker on each line for multiline values
      // Redact certain keys for deterministic snapshots
      const formatValue = (val: unknown, marker: "+" | "-") => {
        const displayVal = key in redactedKeys ? redactedKeys[key] : val;
        const lines = JSON.stringify(displayVal, null, 2).split("\n");
        return lines
          .map((line, i) => (i === 0 ? line : `${marker}   ${line}`))
          .join("\n");
      };

      if (!beforeExists && afterExists) {
        // Added
        diffLines.push(`+ "${key}": ${formatValue(afterValue, "+")}`);
      } else if (beforeExists && !afterExists) {
        // Removed
        diffLines.push(`- "${key}": ${formatValue(beforeValue, "-")}`);
      } else if (JSON.stringify(beforeValue) !== JSON.stringify(afterValue)) {
        // Changed
        diffLines.push(`- "${key}": ${formatValue(beforeValue, "-")}`);
        diffLines.push(`+ "${key}": ${formatValue(afterValue, "+")}`);
      }
    }

    expect(diffLines.join("\n")).toMatchSnapshot();
  }

  async setUpTestProvider() {
    await this.page.getByText("Add custom providerConnect to").click();
    // Fill out provider dialog
    await this.page
      .getByRole("textbox", { name: "Provider ID" })
      .fill("testing");
    await this.page.getByRole("textbox", { name: "Display Name" }).click();
    await this.page
      .getByRole("textbox", { name: "Display Name" })
      .fill("test-provider");
    await this.page.getByText("API Base URLThe base URL for").click();
    await this.page
      .getByRole("textbox", { name: "API Base URL" })
      .fill(`http://localhost:${this.fakeLlmPort}/v1`);
    await this.page.getByRole("button", { name: "Add Provider" }).click();
  }

  async setUpTestModel() {
    await this.page.getByRole("heading", { name: "test-provider" }).click();
    await this.page.getByRole("button", { name: "Add Custom Model" }).click();
    await this.page
      .getByRole("textbox", { name: "Model ID*" })
      .fill("test-model");
    await this.page.getByRole("textbox", { name: "Model ID*" }).press("Tab");
    await this.page.getByRole("textbox", { name: "Name*" }).fill("test-model");
    await this.page.getByRole("button", { name: "Add Model" }).click();
  }

  async addCustomTestModel({
    name,
    contextWindow,
  }: {
    name: string;
    contextWindow?: number;
  }) {
    await this.page.getByRole("heading", { name: "test-provider" }).click();
    await this.page.getByRole("button", { name: "Add Custom Model" }).click();
    await this.page.getByRole("textbox", { name: "Model ID*" }).fill(name);
    await this.page.getByRole("textbox", { name: "Model ID*" }).press("Tab");
    await this.page.getByRole("textbox", { name: "Name*" }).fill(name);
    if (contextWindow) {
      await this.page.locator("#context-window").fill(String(contextWindow));
    }
    await this.page.getByRole("button", { name: "Add Model" }).click();
  }

  async setUpTestProviderApiKey() {
    // Fill in a test API key for the custom provider
    await this.page
      .getByPlaceholder(/Enter new.*API Key here/)
      .fill("test-api-key-12345");
    await this.page.getByRole("button", { name: "Save Key" }).click();
    // Wait for the key to be saved
    await expect(this.page.getByText("test-api-key-12345")).toBeVisible();
  }

  async setUpDyadProvider() {
    await this.page
      .locator("div")
      .filter({ hasText: /^DyadNeeds Setup$/ })
      .nth(1)
      .click();
    await this.page.getByRole("textbox", { name: "Set Dyad API Key" }).click();
    await this.page
      .getByRole("textbox", { name: "Set Dyad API Key" })
      .fill("testdyadkey");
    await this.page.getByRole("button", { name: "Save Key" }).click();
  }
}
