import { test } from "./helpers/test_helper";

test("manage context - default", async ({ po }) => {
  await po.setUp();
  await po.importApp("context-manage");

  const dialog = await po.openContextFilesPicker();
  await po.snapshotDialog();
  await dialog.addManualContextFile("DELETETHIS");
  await dialog.removeManualContextFile();
  await dialog.addManualContextFile("src/**/*.ts");
  await dialog.addManualContextFile("src/sub/**");
  await po.snapshotDialog();
  await dialog.close();

  await po.sendPrompt("[dump]");

  await po.snapshotServerDump("all-messages");
});

test("manage context - smart context", async ({ po }) => {
  await po.setUpDyadPro();
  await po.selectModel({ provider: "Google", model: "Gemini 2.5 Pro" });
  await po.importApp("context-manage");

  let dialog = await po.openContextFilesPicker();
  await po.snapshotDialog();

  await dialog.addManualContextFile("src/**/*.ts");
  await dialog.addManualContextFile("src/sub/**");
  await dialog.addAutoIncludeContextFile("a.ts");
  await dialog.addAutoIncludeContextFile("manual/**");
  await po.snapshotDialog();
  await dialog.close();

  await po.sendPrompt("[dump]");

  await po.snapshotServerDump("request");
  await po.snapshotServerDump("all-messages");

  // Disabling smart context will automatically disable
  // the auto-includes.
  const proModesDialog = await po.openProModesDialog();
  await proModesDialog.toggleSmartContext();
  await proModesDialog.close();

  await po.sendPrompt("[dump]");
  await po.snapshotServerDump("request");

  // Removing manual context files will result in all files being included.
  dialog = await po.openContextFilesPicker();
  await dialog.removeManualContextFile();
  await dialog.removeManualContextFile();
  await dialog.close();

  await po.sendPrompt("[dump]");
  await po.snapshotServerDump("request");
});

test("manage context - smart context - auto-includes only", async ({ po }) => {
  await po.setUpDyadPro();
  await po.selectModel({ provider: "Google", model: "Gemini 2.5 Pro" });
  await po.importApp("context-manage");

  const dialog = await po.openContextFilesPicker();
  await po.snapshotDialog();

  await dialog.addAutoIncludeContextFile("a.ts");
  await dialog.addAutoIncludeContextFile("manual/**");
  await po.snapshotDialog();
  await dialog.close();

  await po.sendPrompt("[dump]");

  await po.snapshotServerDump("request");
});
