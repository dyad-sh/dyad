/**
 * Page object for model picker functionality.
 * Handles model and provider selection.
 */

import { expect, type Locator, Page } from "@playwright/test";

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

  private getModelItem(provider: string, model: string) {
    return this.page
      .locator("[data-model-provider][data-model-name]")
      .filter({
        has: this.page.getByText(model, { exact: true }),
      })
      .and(this.page.locator(`[data-model-provider="${provider}"]`))
      .first();
  }

  private getEffortModelItem(model: string) {
    return this.page
      .getByRole("menuitem", {
        name: new RegExp(
          `^${this.escapeRegExp(model)}(?:\\s+${this.escapeRegExp(model)})?\\.(?:\\s|$).*Effort:`,
          "i",
        ),
      })
      .first();
  }

  private async selectVisibleModel(modelItem: Locator, model: string) {
    await modelItem.click();
    await expect(this.page.getByTestId("model-picker")).toHaveText(
      new RegExp(
        `^(?:Model:\\s*)?${this.escapeRegExp(model)}\\s+\\([^)]+\\)$`,
        "i",
      ),
    );
  }

  private async clickModel(provider: string, model: string) {
    const providerModelItem = this.getModelItem(provider, model);
    const modelItem = (await providerModelItem.count())
      ? providerModelItem
      : this.getEffortModelItem(model);
    await expect(modelItem).toBeVisible();
    await this.selectVisibleModel(modelItem, model);
  }

  async selectModel({ provider, model }: { provider: string; model: string }) {
    await this.page.getByTestId("model-picker").click();
    const directModel = this.getModelItem(provider, model);
    if (
      await directModel
        .waitFor({ state: "visible", timeout: 1_000 })
        .then(() => true)
        .catch(() => false)
    ) {
      await this.selectVisibleModel(directModel, model);
      return;
    }
    const directEffortModel = this.getEffortModelItem(model);
    if (
      await directEffortModel
        .waitFor({ state: "visible", timeout: 1_000 })
        .then(() => true)
        .catch(() => false)
    ) {
      await this.selectVisibleModel(directEffortModel, model);
      return;
    }

    if (!(await this.clickMenuItemIfVisible(provider, false))) {
      await this.getMenuItem("More models").click();
      await this.getMenuItem(provider, false).click();
    }
    await this.clickModel(provider, model);
  }

  async selectTestModel() {
    // Custom provider models appear directly in the flat tier list.
    await this.selectModel({ provider: "test-provider", model: "test-model" });
  }

  async selectTestOllamaModel() {
    await this.page.getByTestId("model-picker").click();
    await this.getMenuItem("Local models", false).click();
    await this.getMenuItem("Ollama", false).click();
    await this.getMenuItem("Testollama", false).click();
  }

  async selectTestLMStudioModel() {
    await this.page.getByTestId("model-picker").click();
    await this.getMenuItem("Local models", false).click();
    await this.getMenuItem("LM Studio", false).click();
    await this.getMenuItem("lmstudio-model-1", false).click();
  }

  async selectTestAzureModel() {
    await this.page.getByTestId("model-picker").click();
    await this.getMenuItem("More models").click();
    await this.getMenuItem("Azure OpenAI", false).click();
    await this.clickModel("azure", "GPT-5");
  }
}
