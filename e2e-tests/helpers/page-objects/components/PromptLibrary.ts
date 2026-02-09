/**
 * Page object for prompt library functionality.
 * Handles creating and managing prompts.
 */

import { Page } from "@playwright/test";

export class PromptLibrary {
  constructor(public page: Page) {}

  async createPrompt({
    title,
    description,
    content,
  }: {
    title: string;
    description?: string;
    content: string;
  }) {
    await this.page.getByRole("button", { name: "New Prompt" }).click();
    await this.page.getByRole("textbox", { name: "Title" }).fill(title);
    if (description) {
      await this.page
        .getByRole("textbox", { name: "Description (optional)" })
        .fill(description);
    }
    await this.page.getByRole("textbox", { name: "Content" }).fill(content);
    await this.page.getByRole("button", { name: "Save" }).click();
  }
}
