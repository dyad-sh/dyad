/**
 * Page object for model picker functionality.
 * Handles model and provider selection.
 */

import { expect, Page } from "@playwright/test";

export class ModelPicker {
  constructor(public page: Page) {}

  private escapeRegExp(value: string) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  private getMenuItem(name: string, exact = true) {
    if (!exact) {
      return this.page.getByRole("menuitem", { name, exact: false }).first();
    }

    return this.page
      .getByRole("menuitem", {
        name: new RegExp(
          `^${this.escapeRegExp(name)}(?:\\s+${this.escapeRegExp(name)})?$`,
          "i",
        ),
      })
      .first();
  }

  private async clickMenuItemIfVisible(name: string, exact = true) {
    const item = this.getMenuItem(name, exact);
    if (
      await item
        .waitFor({ state: "visible", timeout: 1_000 })
        .then(() => true)
        .catch(() => false)
    ) {
      await item.click();
      return true;
    }
    return false;
  }

  private async clickModel(model: string) {
    const modelItem = this.getMenuItem(model);
    await expect(modelItem).toBeVisible();
    await modelItem.click();
  }

  async selectModel({ provider, model }: { provider: string; model: string }) {
    await this.page.getByTestId("model-picker").click();
    if (await this.clickMenuItemIfVisible(model)) {
      return;
    }

    if (!(await this.clickMenuItemIfVisible(provider, false))) {
      await this.getMenuItem("More models").click();
      await this.getMenuItem(provider, false).click();
    }
    await this.clickModel(model);
  }

  async selectTestModel() {
    // Custom provider models appear directly in the flat tier list.
    await this.selectModel({ provider: "test-provider", model: "test-model" });
  }

  async selectTestOllamaModel() {
    await this.page.getByTestId("model-picker").click();
    await this.getMenuItem("Local models", false).click();
    await this.getMenuItem("Ollama", false).click();
    await this.clickModel("Testollama");
  }

  async selectTestLMStudioModel() {
    await this.page.getByTestId("model-picker").click();
    await this.getMenuItem("Local models", false).click();
    await this.getMenuItem("LM Studio", false).click();
    await this.clickModel("lmstudio-model-1");
  }

  async selectTestAzureModel() {
    await this.page.getByTestId("model-picker").click();
    await this.getMenuItem("More models").click();
    await this.getMenuItem("Azure OpenAI", false).click();
    await this.clickModel("GPT-5");
  }
}
