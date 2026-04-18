/**
 * Page object for model picker functionality.
 * Handles model and provider selection.
 */

import { expect, Page } from "@playwright/test";

export class ModelPicker {
  constructor(public page: Page) {}

  async selectModel({ provider, model }: { provider: string; model: string }) {
    await this.page.getByTestId("model-picker").click();
    await this.page.getByText(provider, { exact: true }).click();
    await this.page.getByText(model, { exact: true }).click();
  }

  async selectTestModel() {
    await this.page.getByTestId("model-picker").click();
    const providerItem = this.page.getByText("test-provider");
    await expect(providerItem).toBeVisible();
    await providerItem.click();
    const modelItem = this.page.getByText("test-model");
    await expect(modelItem).toBeVisible();
    await modelItem.click();
  }

  async selectTestOllamaModel() {
    await this.page.getByTestId("model-picker").click();
    await this.page.getByText("Local models").click();
    await this.page.getByText("Ollama", { exact: true }).click();
    await this.page.getByText("Testollama", { exact: true }).click();
  }

  async selectTestLMStudioModel() {
    await this.page.getByTestId("model-picker").click();
    await this.page.getByText("Local models").click();
    await this.page.getByText("LM Studio", { exact: true }).click();
    // Both of the elements that match "lmstudio-model-1" are the same button, so we just pick the first.
    await this.page
      .getByText("lmstudio-model-1", { exact: true })
      .first()
      .click();
  }

  async selectTestAzureModel() {
    await this.page.getByTestId("model-picker").click();
    await this.page.getByText("Other AI providers").click();
    await this.page.getByText("Azure OpenAI", { exact: true }).click();
    await this.page.getByText("GPT-5", { exact: true }).click();
  }
}
