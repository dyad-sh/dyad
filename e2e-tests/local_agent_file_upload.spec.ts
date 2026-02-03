import path from "path";
import fs from "fs";
import { expect } from "@playwright/test";
import { testSkipIfWindows } from "./helpers/test_helper";

/**
 * Test for file upload to codebase in local-agent mode.
 *
 * This tests that when a file is uploaded with "upload to codebase" mode,
 * the local agent's write_file tool correctly resolves the file ID
 * (e.g., DYAD_ATTACHMENT_0) to the actual uploaded file content.
 */
testSkipIfWindows("local-agent - upload file to codebase", async ({ po }) => {
  await po.setUpDyadPro({ localAgent: true });
  await po.importApp("minimal");
  await po.selectLocalAgentMode();

  // Open auxiliary actions menu
  await po
    .getChatInputContainer()
    .getByTestId("auxiliary-actions-menu")
    .click();

  // Click "Attach files" to open submenu
  await po.page.getByRole("menuitem", { name: "Attach files" }).click();

  // Wait for submenu content to be visible
  const uploadItem = po.page.getByText("Upload file to codebase");
  await expect(uploadItem).toBeVisible();

  // Set up file chooser listener BEFORE clicking the menu item
  const fileChooserPromise = po.page.waitForEvent("filechooser");

  // Click the menu item to trigger the file picker
  await uploadItem.click();

  // Handle the file chooser dialog
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles("e2e-tests/fixtures/images/logo.png");

  // Send prompt that triggers the upload-to-codebase fixture
  await po.sendPrompt("tc=local-agent/upload-to-codebase");

  // Verify the file was written to the codebase
  const appPath = await po.getCurrentAppPath();
  const filePath = path.join(appPath, "assets", "uploaded-file.png");

  // The file should exist
  expect(fs.existsSync(filePath)).toBe(true);

  // The file contents should match the original uploaded file
  const expectedContents = fs.readFileSync(
    "e2e-tests/fixtures/images/logo.png",
    "base64",
  );
  const actualContents = fs.readFileSync(filePath, "base64");
  expect(actualContents).toBe(expectedContents);

  // Snapshot the messages
  await po.snapshotMessages();
});
