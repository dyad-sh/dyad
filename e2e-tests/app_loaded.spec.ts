import { expect } from "@playwright/test";
import { test } from "./helpers/test_helper";

test.describe("App Loaded", () => {
  test("app loads successfully with main UI elements visible", async ({
    po,
  }) => {
    // Verify the main heading is displayed
    await expect(po.page.getByRole("heading", { level: 1 })).toHaveText(
      "Build a new app",
    );

    // Verify navigation tabs are present
    await expect(po.page.getByRole("link", { name: "Apps" })).toBeVisible();
    await expect(po.page.getByRole("link", { name: "Chat" })).toBeVisible();
    await expect(po.page.getByRole("link", { name: "Settings" })).toBeVisible();

    // Verify the home chat input is available (main entry point for building apps)
    await expect(
      po.page.getByTestId("home-chat-input-container"),
    ).toBeVisible();
  });
});
