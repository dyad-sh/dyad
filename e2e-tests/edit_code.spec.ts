import { test } from "./helpers/test_helper";
import { expect } from "@playwright/test";
import fs from "fs";
import path from "path";

test("edit code", async ({ po }) => {
  const editedFilePath = path.join("src", "components", "made-with-dyad.tsx");
  await po.sendPrompt("foo");
  const appPath = await po.getCurrentAppPath();

  await po.clickTogglePreviewPanel();

  await po.selectPreviewMode("code");
  await po.page.getByText("made-with-dyad.tsx").click();
  await po.page
    .getByRole("code")
    .locator("div")
    .filter({ hasText: "export const" })
    .nth(4)
    .click();
  await po.page
    .getByRole("textbox", { name: "Editor content" })
    .fill("export const MadeWithDyad = ;");

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
  expect(editedFile).toContain("export const MadeWithDyad = ;");
});

test("edit code edits the right file", async ({ po }) => {
  const editedFilePath = path.join("src", "components", "made-with-dyad.tsx");
  const robotsFilePath = path.join("public", "robots.txt");
  await po.sendPrompt("foo");
  const appPath = await po.getCurrentAppPath();
  const originalRobotsFile = fs.readFileSync(
    path.join(appPath, robotsFilePath),
    "utf8",
  );

  await po.clickTogglePreviewPanel();

  await po.selectPreviewMode("code");
  await po.page.getByText("made-with-dyad.tsx").click();
  await po.page
    .getByRole("code")
    .locator("div")
    .filter({ hasText: "export const" })
    .nth(4)
    .click();
  await po.page
    .getByRole("textbox", { name: "Editor content" })
    .fill("export const MadeWithDyad = ;");

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
  expect(editedFile).toContain("export const MadeWithDyad = ;");

  // Make sure the robots.txt file is not edited
  const editedRobotsFile = fs.readFileSync(
    path.join(appPath, robotsFilePath),
    "utf8",
  );
  expect(editedRobotsFile).toEqual(originalRobotsFile);
});
