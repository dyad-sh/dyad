import path from "path";
import { testSkipIfWindows } from "./helpers/test_helper";
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
