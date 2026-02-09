import { testWithConfig } from "./helpers/test_helper";
import { expect } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";

const testWithTemplateDialog = testWithConfig({
  preLaunchHook: async ({ userDataDir }) => {
    // Enable the template selection dialog (overrides the default test fixture setting)
    fs.writeFileSync(
      path.join(userDataDir, "user-settings.json"),
      JSON.stringify({ promptForTemplate: true }),
    );
  },
});

testWithTemplateDialog("select template dialog - cancel", async ({ po }) => {
  await po.setUp();

  const beforeSettings = po.recordSettings();

  // Type a prompt and submit from home page
  await po.getChatInput().fill("test prompt");
  await po.page.getByRole("button", { name: "Send message" }).click();

  // Template selection dialog should appear
  await expect(
    po.page.getByRole("heading", { name: "Select a Template" }),
  ).toBeVisible();

  // Cancel should dismiss the dialog without side effects
  await po.page.getByRole("button", { name: "Cancel" }).click();
  await expect(
    po.page.getByRole("heading", { name: "Select a Template" }),
  ).not.toBeVisible();

  po.snapshotSettingsDelta(beforeSettings);
});

testWithTemplateDialog(
  "select template dialog - continue with template",
  async ({ po }) => {
    await po.setUp();

    const beforeSettings = po.recordSettings();

    // Type a prompt and submit from home page
    await po.getChatInput().fill("tc=edit-made-with-dyad");
    await po.page.getByRole("button", { name: "Send message" }).click();

    // Template selection dialog should appear
    await expect(
      po.page.getByRole("heading", { name: "Select a Template" }),
    ).toBeVisible();

    // Select Next.js template and check "Don't show again"
    await po.page.getByRole("img", { name: "Next.js Template" }).click();
    await po.page.getByText("Don't show me this again").click();

    // Continue should dismiss dialog and proceed with app creation
    await po.page.getByRole("button", { name: "Continue" }).click();
    await expect(
      po.page.getByRole("heading", { name: "Select a Template" }),
    ).not.toBeVisible();

    await po.waitForChatCompletion();
    po.snapshotSettingsDelta(beforeSettings);
  },
);
