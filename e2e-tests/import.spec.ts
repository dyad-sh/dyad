import path from "path";
import { testSkipIfWindows } from "./helpers/test_helper";
import { expect } from "@playwright/test";
import * as eph from "electron-playwright-helpers";

testSkipIfWindows("import app", async ({ po }) => {
  await po.setUp();
  await po.page.getByRole("button", { name: "Import App" }).click();
  await eph.stubDialog(po.electronApp, "showOpenDialog", {
    filePaths: [path.join(__dirname, "fixtures", "import-app", "minimal")],
  });

  await po.page.getByRole("button", { name: "Select Folder" }).click();
  await po.page.getByRole("textbox", { name: "Enter new app name" }).click();
  await po.page
    .getByRole("textbox", { name: "Enter new app name" })
    .fill("minimal-imported-app");
  await po.page.getByRole("button", { name: "Import" }).click();

  await po.snapshotPreview();
  await po.snapshotMessages();
});

testSkipIfWindows("import app with AI rules", async ({ po }) => {
  await po.setUp();
  await po.page.getByRole("button", { name: "Import App" }).click();
  await eph.stubDialog(po.electronApp, "showOpenDialog", {
    filePaths: [
      path.join(__dirname, "fixtures", "import-app", "minimal-with-ai-rules"),
    ],
  });

  await po.page.getByRole("button", { name: "Select Folder" }).click();
  await po.page.getByRole("textbox", { name: "Enter new app name" }).click();
  await po.page
    .getByRole("textbox", { name: "Enter new app name" })
    .fill("minimal-imported-app");
  await po.page.getByRole("button", { name: "Import" }).click();

  await po.snapshotPreview();

  await po.sendPrompt("[dump]");

  await po.snapshotServerDump();
  await po.snapshotMessages({ replaceDumpPath: true });
});

testSkipIfWindows("import app with custom commands", async ({ po }) => {
  await po.setUp();
  await po.page.getByRole("button", { name: "Import App" }).click();
  await eph.stubDialog(po.electronApp, "showOpenDialog", {
    filePaths: [path.join(__dirname, "fixtures", "import-app", "minimal")],
  });
  await po.page.getByRole("button", { name: "Select Folder" }).click();
  await po.page
    .getByRole("textbox", { name: "Enter new app name" })
    .fill("minimal-imported-app");

  await po.page.getByRole("button", { name: "Advanced options" }).click();

  await po.page.getByPlaceholder("pnpm install").fill("");
  await po.page.getByPlaceholder("pnpm dev").fill("npm start");
  await expect(po.page.getByRole("button", { name: "Import" })).toBeDisabled();
  await expect(
    po.page.getByText("Both commands are required when customizing."),
  ).toBeVisible();

  await po.page.getByPlaceholder("pnpm install").fill("npm i");
  await expect(po.page.getByRole("button", { name: "Import" })).toBeEnabled();
  await expect(
    po.page.getByText("Both commands are required when customizing."),
  ).toHaveCount(0);

  await po.page.getByRole("button", { name: "Import" }).click();
});

testSkipIfWindows(
  "advanced options: both cleared are valid and use defaults",
  async ({ po }) => {
    await po.setUp();
    await po.page.getByRole("button", { name: "Import App" }).click();
    await eph.stubDialog(po.electronApp, "showOpenDialog", {
      filePaths: [path.join(__dirname, "fixtures", "import-app", "minimal")],
    });
    await po.page.getByRole("button", { name: "Select Folder" }).click();

    await po.page
      .getByRole("textbox", { name: "Enter new app name" })
      .fill("both-cleared");

    await po.page.getByRole("button", { name: "Advanced options" }).click();
    await po.page.getByPlaceholder("pnpm install").fill("");
    await po.page.getByPlaceholder("pnpm dev").fill("");

    await expect(po.page.getByRole("button", { name: "Import" })).toBeEnabled();

    await po.page.getByRole("button", { name: "Import" }).click();

    await po.snapshotPreview();
  },
);
