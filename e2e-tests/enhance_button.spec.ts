import { test, expect } from "@playwright/test";

// This test suite assumes IS_TEST_BUILD so prompt enhancement returns "[enhanced] <text>"

test.describe("Prompt enhancement - button mode", () => {
  test("Home: Enhance button enhances and starts chat", async ({ page }) => {
    // Go to settings
    await page.goto("/");
    await page.getByRole("link", { name: "Settings" }).click();

    // Navigate to AI Settings -> Prompt Enhancement and choose Button
    await page.locator("text=AI Settings").scrollIntoViewIfNeeded();
    await page.locator("text=Prompt Enhancement").scrollIntoViewIfNeeded();
    await page.getByRole("button", { name: "Button (Enhance+Send)" }).click();

    // Go home
    await page.goto("/");

    const HOME_INPUT = page.getByPlaceholder("Ask Dyad to build...");
    await HOME_INPUT.click();
    await HOME_INPUT.fill("make a simple hello world app");

    await page.getByRole("button", { name: /Enhance/ }).click();

    // Should navigate to chat and show an assistant message processing
    await page.waitForURL(/\/chat\?id=.*/);

    // Wait for the user message to be recorded with [enhanced]
    await expect(page.locator("text=[enhanced] make a simple hello world app")).toBeVisible({ timeout: 30000 });
  });
});
