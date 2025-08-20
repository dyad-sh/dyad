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
  await proModesDialog.setSmartContextMode("off");
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

test("manage context - exclude paths", async ({ po }) => {
  await po.setUp();
  await po.importApp("context-manage");

  const dialog = await po.openContextFilesPicker();
  await po.snapshotDialog();

  // Add some include paths first
  await dialog.addManualContextFile("src/**/*.ts");
  await dialog.addManualContextFile("manual/**");

  // Add exclude paths
  await dialog.addExcludeContextFile("src/components/**");
  await dialog.addExcludeContextFile("manual/exclude/**");
  await po.snapshotDialog();
  await dialog.close();

  await po.sendPrompt("[dump]");
  await po.snapshotServerDump("all-messages", { name: "exclude-paths-basic" });

  // Test that exclude paths take precedence over include paths
  const dialog2 = await po.openContextFilesPicker();
  await dialog2.removeExcludeContextFile(); // Remove src/components/**
  await dialog2.addExcludeContextFile("src/**"); // This should exclude everything from src
  await po.snapshotDialog();
  await dialog2.close();

  await po.sendPrompt("[dump]");
  await po.snapshotServerDump("all-messages", {
    name: "exclude-paths-precedence",
  });
});

test("manage context - exclude paths with smart context", async ({ po }) => {
  await po.setUpDyadPro();
  await po.selectModel({ provider: "Google", model: "Gemini 2.5 Pro" });
  await po.importApp("context-manage");

  const dialog = await po.openContextFilesPicker();
  await po.snapshotDialog();

  // Add manual context files
  await dialog.addManualContextFile("src/**/*.ts");
  await dialog.addManualContextFile("manual/**");

  // Add smart context auto-includes
  await dialog.addAutoIncludeContextFile("a.ts");
  await dialog.addAutoIncludeContextFile("exclude/**");

  // Add exclude paths that should filter out some of the above
  await dialog.addExcludeContextFile("src/components/**");
  await dialog.addExcludeContextFile("exclude/exclude.ts");
  await po.snapshotDialog();
  await dialog.close();

  await po.sendPrompt("[dump]");
  await po.snapshotServerDump("all-messages", {
    name: "exclude-paths-with-smart-context",
  });
});
