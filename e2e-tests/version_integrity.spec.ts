import { PageObject, testSkipIfWindows } from "./helpers/test_helper";

import * as eph from "electron-playwright-helpers";
import path from "node:path";

const runVersionIntegrityTest = async (po: PageObject, nativeGit: boolean) => {
  await po.setUp({ autoApprove: true, nativeGit });

  // Importing a simple app with a few files.
  await po.page.getByRole("button", { name: "Import App" }).click();
  await eph.stubDialog(po.electronApp, "showOpenDialog", {
    filePaths: [
      path.join(__dirname, "fixtures", "import-app", "version-integrity"),
    ],
  });

  await po.page.getByRole("button", { name: "Select Folder" }).click();
  await po.page.getByRole("textbox", { name: "Enter new app name" }).click();
  await po.page
    .getByRole("textbox", { name: "Enter new app name" })
    .fill("version-integrity-app");
  await po.page.getByRole("button", { name: "Import" }).click();

  // Initial snapshot
  await po.snapshotAppFiles({ name: "v1" });

  // Add a file and delete a file
  await po.sendPrompt("tc=version-integrity-add-edit-delete");
  await po.snapshotAppFiles({ name: "v2" });

  // Move a file
  await po.sendPrompt("tc=version-integrity-move-file");
  await po.snapshotAppFiles({ name: "v3" });

  // Open version pane
  await po.page.getByRole("button", { name: "Version 3" }).click();
  await po.page.getByText("Init Dyad app Restore").click();
  await po.snapshotAppFiles({ name: "v1" });

  await po.page
    .getByRole("button", { name: "Restore to this version" })
    .click();
  // Should be same as the previous snapshot, but just to be sure.
  await po.snapshotAppFiles({ name: "v1" });
};

testSkipIfWindows("version integrity (git isomorphic)", async ({ po }) => {
  await runVersionIntegrityTest(po, false);
});

testSkipIfWindows("version integrity (git native)", async ({ po }) => {
  await runVersionIntegrityTest(po, true);
});
