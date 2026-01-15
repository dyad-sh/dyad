import path from "path";
import os from "os";
import fs from "fs";
import { testSkipIfWindows } from "./helpers/test_helper";
import * as eph from "electron-playwright-helpers";

testSkipIfWindows("import app without copying to dyad-apps", async ({ po }) => {
  await po.setUp();

  // Copy fixture to temp directory to avoid modifying original fixture
  const fixtureSource = path.join(
    __dirname,
    "fixtures",
    "import-app",
    "minimal",
  );
  const tempDir = path.join(os.tmpdir(), `dyad-import-test-${Date.now()}`);
  fs.cpSync(fixtureSource, tempDir, { recursive: true });

  await po.page.getByRole("button", { name: "Import App" }).click();

  await eph.stubDialog(po.electronApp, "showOpenDialog", {
    filePaths: [tempDir],
  });

  await po.page.getByRole("button", { name: "Select Folder" }).click();

  // Uncheck the copy checkbox
  await po.page.getByRole("checkbox", { name: /Copy to the/ }).uncheck();

  // Fill in app name (folder basename is used by default)
  await po.page
    .getByRole("textbox", { name: "Enter new app name" })
    .fill("minimal-in-place");

  await po.page.getByRole("button", { name: "Import" }).click();

  // Verify import succeeded
  await po.snapshotPreview();
});
