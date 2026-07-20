import { testSkipIfWindows, Timeout } from "./helpers/test_helper";
import { expect } from "@playwright/test";
import fs from "fs";
import path from "path";

const MINIMAL_APP = "minimal-with-ai-rules";

testSkipIfWindows(
  "problems - runs app-local TypeScript CLI",
  async ({ po }) => {
    await po.setUp();
    await po.importApp(MINIMAL_APP);
    await po.appManagement.ensurePnpmInstall();
    await po.appManagement.ensureCodeExplorerReady();

    const appPath = await po.appManagement.getCurrentAppPath();
    const typeScriptLibPath = path.join(
      appPath,
      "node_modules",
      "typescript",
      "lib",
    );
    const typeScriptEntryPath = path.join(typeScriptLibPath, "tsc.js");
    const originalEntryName = "tsc-dyad-e2e-original.js";
    const originalEntryPath = path.join(typeScriptLibPath, originalEntryName);
    const invocationLogName = ".dyad-tsc-cli-invocations";
    const invocationLogPath = path.join(typeScriptLibPath, invocationLogName);
    const badFilePath = path.join(appPath, "src", "tsc-cli-error.ts");
    let entryMoved = false;

    try {
      fs.renameSync(typeScriptEntryPath, originalEntryPath);
      entryMoved = true;
      fs.writeFileSync(
        typeScriptEntryPath,
        `const fs = require("node:fs");
const path = require("node:path");
fs.appendFileSync(path.join(__dirname, "${invocationLogName}"), process.argv.slice(2).join(" ") + "\\n");
module.exports = require("./${originalEntryName}");
`,
      );
      fs.writeFileSync(badFilePath, "const mustBeString: string = 42;\n");

      await po.previewPanel.selectPreviewMode("problems");
      await po.previewPanel.clickRecheckProblems();

      const problemRows = po.page.getByTestId("problem-row");
      await expect(problemRows).toHaveCount(1, { timeout: Timeout.LONG });
      await expect(problemRows.first()).toContainText("tsc-cli-error.ts");
      await expect(problemRows.first()).toContainText(
        "Type 'number' is not assignable to type 'string'",
      );

      const invocations = fs
        .readFileSync(invocationLogPath, "utf8")
        .trim()
        .split("\n");
      expect(invocations).toContain("--version");

      const typeCheckInvocation =
        invocations.find((invocation) => invocation.includes("--noEmit")) ?? "";
      expect(typeCheckInvocation).toContain("--pretty false");
      expect(typeCheckInvocation).toContain("--noEmit");
      expect(typeCheckInvocation).toContain("--incremental");
      expect(typeCheckInvocation).toContain("--project");
      expect(typeCheckInvocation).toContain("tsconfig.app.json");
    } finally {
      fs.rmSync(badFilePath, { force: true });
      fs.rmSync(invocationLogPath, { force: true });
      if (entryMoved) {
        fs.rmSync(typeScriptEntryPath, { force: true });
        fs.renameSync(originalEntryPath, typeScriptEntryPath);
      }
    }
  },
);

testSkipIfWindows("problems - fix all", async ({ po }) => {
  await po.setUp();
  await po.importApp(MINIMAL_APP);
  const appPath = await po.appManagement.getCurrentAppPath();
  const badFilePath = path.join(appPath, "src", "bad-file.tsx");
  fs.writeFileSync(
    badFilePath,
    `const App = () => <div>Minimal imported app</div>;
nonExistentFunction1();
nonExistentFunction2();
nonExistentFunction3();

export default App;
`,
  );
  await po.appManagement.ensurePnpmInstall();
  await po.appManagement.ensureCodeExplorerReady();

  await po.sendPrompt("tc=create-ts-errors");
  await po.previewPanel.selectPreviewMode("problems");
  await po.previewPanel.clickRecheckProblems();
  await po.previewPanel.clickFixAllProblems();
  await po.chatActions.waitForChatCompletion();

  await po.snapshotServerDump("last-message");
  await po.snapshotMessages({ replaceDumpPath: true });
});

testSkipIfWindows(
  "problems - select specific problems and fix",
  async ({ po }) => {
    await po.setUp();
    await po.importApp(MINIMAL_APP);

    // Create multiple TS errors in one file
    const appPath = await po.appManagement.getCurrentAppPath();
    const badFilePath = path.join(appPath, "src", "bad-file.tsx");
    fs.writeFileSync(
      badFilePath,
      `const App = () => <div>Minimal imported app</div>;
nonExistentFunction1();
nonExistentFunction2();
nonExistentFunction3();

export default App;
`,
    );

    await po.appManagement.ensurePnpmInstall();

    // Trigger creation of problems and open problems panel
    // await po.sendPrompt("tc=create-ts-errors");
    await po.previewPanel.selectPreviewMode("problems");
    await po.previewPanel.clickRecheckProblems();

    // Initially, all selected: button shows Fix X problems and Clear all is visible
    const fixButton = po.page.getByTestId("fix-all-button");
    await expect(fixButton).toBeVisible({ timeout: Timeout.LONG });
    await expect(fixButton).toContainText(/Fix \d+ problem\(s\)/);

    // Click first two rows to toggle off (deselect)
    const rows = po.page.getByTestId("problem-row");
    const rowCount = await rows.count();
    expect(rowCount).toBeGreaterThan(2);
    await rows.nth(0).click();
    await rows.nth(1).click();

    // Button should update to reflect remaining selected
    await expect(fixButton).toContainText(/Fix 1 problem\(s\)/);

    // Clear all should switch to Select all when none selected
    // Deselect remaining rows
    for (let i = 2; i < rowCount; i++) {
      await rows.nth(i).click();
    }

    const selectButton = po.page.getByRole("button", {
      name: /Select all/,
    });
    await expect(selectButton).toHaveText("Select all");

    // Select all, then fix selected
    await selectButton.click();
    // Unselect the second row
    await rows.nth(1).click();
    await expect(fixButton).toContainText(/Fix 2 problem\(s\)/);

    await fixButton.click();
    await po.chatActions.waitForChatCompletion();
    await po.snapshotServerDump("last-message");
    await po.snapshotMessages({ replaceDumpPath: true });
  },
);

testSkipIfWindows("problems - manual edit (react/vite)", async ({ po }) => {
  await po.setUp();
  await po.sendPrompt("tc=1");

  const appPath = await po.appManagement.getCurrentAppPath();
  const badFilePath = path.join(appPath, "src", "bad-file.tsx");
  fs.writeFileSync(
    badFilePath,
    `const App = () => <div>Minimal imported app</div>;
nonExistentFunction();    

export default App;
`,
  );
  await po.appManagement.ensurePnpmInstall();
  await po.appManagement.ensureCodeExplorerReady();
  await po.previewPanel.clickTogglePreviewPanel();

  await po.previewPanel.selectPreviewMode("problems");
  await po.previewPanel.clickRecheckProblems();
  const fixButton = po.page.getByTestId("fix-all-button");
  await expect(fixButton).toBeEnabled({ timeout: Timeout.LONG });
  await expect(fixButton).toContainText(/Fix 1 problem\(s\)/);

  fs.unlinkSync(badFilePath);

  await po.previewPanel.clickRecheckProblems();
  await expect(fixButton).toBeDisabled({ timeout: Timeout.LONG });
  await expect(fixButton).toContainText(/Fix 0 problem\(s\)/);
});

testSkipIfWindows("problems - manual edit (next.js)", async ({ po }) => {
  await po.setUp();
  await po.navigation.goToTemplatesAndSelectTemplate("Next.js Template");
  await po.sendPrompt("tc=1");

  const appPath = await po.appManagement.getCurrentAppPath();
  const badFilePath = path.join(appPath, "src", "bad-file.tsx");
  fs.writeFileSync(
    badFilePath,
    `const App = () => <div>Minimal imported app</div>;
  nonExistentFunction();    
  
  export default App;
  `,
  );
  await po.appManagement.ensurePnpmInstall();
  await po.appManagement.ensureCodeExplorerReady();
  await po.previewPanel.clickTogglePreviewPanel();

  await po.previewPanel.selectPreviewMode("problems");
  await po.previewPanel.clickRecheckProblems();
  const fixButton = po.page.getByTestId("fix-all-button");
  await expect(fixButton).toBeEnabled({ timeout: Timeout.LONG });
  await expect(fixButton).toContainText(/Fix 1 problem\(s\)/);

  fs.unlinkSync(badFilePath);

  await po.previewPanel.clickRecheckProblems();
  await expect(fixButton).toBeDisabled({ timeout: Timeout.LONG });
  await expect(fixButton).toContainText(/Fix 0 problem\(s\)/);
});
