import { test } from "./helpers/test_helper";
import { expect } from "@playwright/test";
import fs from "fs";
import path from "path";

test("edit code", async ({ po }) => {
  await po.setUp({ autoApprove: true });
  const editedFilePath = path.join("src", "components", "made-with-coney.tsx");
  await po.sendPrompt("foo");
  const appPath = await po.appManagement.getCurrentAppPath();

  await po.previewPanel.clickTogglePreviewPanel();

  await po.previewPanel.selectPreviewMode("code");
  await po.page.getByText("made-with-coney.tsx").click();
  // Wait for the editor to load and then fill in the new content
  const editorContent = po.page.getByRole("textbox", {
    name: "Editor content",
  });
  await expect(editorContent).toBeVisible();
  // Monaco editor intercepts pointer events, so we need to use force: true
  await editorContent.click({ force: true });
  await po.page.keyboard.press("ControlOrMeta+a");
  await po.page.keyboard.type("export const MadeWithConey = ;");

  // Save the file
  await po.page.getByTestId("save-file-button").click();

  // Expect toast to be visible
  await expect(po.page.getByText("File saved")).toBeVisible();

  // We are NOT snapshotting the app files because the Monaco UI edit
  // is not deterministic.
  const editedFile = fs.readFileSync(
    path.join(appPath, editedFilePath),
    "utf8",
  );
  expect(editedFile).toContain("export const MadeWithConey = ;");
});

test("edit code edits the right file", async ({ po }) => {
  await po.setUp({ autoApprove: true });
  const editedFilePath = path.join("src", "components", "made-with-coney.tsx");
  const robotsFilePath = path.join("public", "robots.txt");
  await po.sendPrompt("foo");
  const appPath = await po.appManagement.getCurrentAppPath();
  const originalRobotsFile = fs.readFileSync(
    path.join(appPath, robotsFilePath),
    "utf8",
  );

  await po.previewPanel.clickTogglePreviewPanel();

  await po.previewPanel.selectPreviewMode("code");
  await po.page.getByText("made-with-coney.tsx").click();
  // Wait for the editor to load and then fill in the new content
  const editorContent = po.page.getByRole("textbox", {
    name: "Editor content",
  });
  await expect(editorContent).toBeVisible();
  // Monaco editor intercepts pointer events, so we need to use force: true
  await editorContent.click({ force: true });
  await po.page.keyboard.press("ControlOrMeta+a");
  await po.page.keyboard.type("export const MadeWithConey = ;");

  // Save the file by switching files
  await po.page.getByText("robots.txt").click();

  // Expect toast to be visible
  await expect(po.page.getByText("File saved")).toBeVisible();

  // We are NOT snapshotting the app files because the Monaco UI edit
  // is not deterministic.
  const editedFile = fs.readFileSync(
    path.join(appPath, editedFilePath),
    "utf8",
  );
  expect(editedFile).toContain("export const MadeWithConey = ;");

  // Make sure the robots.txt file is not edited
  const editedRobotsFile = fs.readFileSync(
    path.join(appPath, robotsFilePath),
    "utf8",
  );
  expect(editedRobotsFile).toEqual(originalRobotsFile);
});
