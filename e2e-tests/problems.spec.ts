import { test, testSkipIfWindows, Timeout } from "./helpers/test_helper";
import { expect } from "@playwright/test";
import fs from "fs";
import path from "path";

const MINIMAL_APP = "minimal-with-ai-rules";

test("problems auto-fix - enabled", async ({ po }) => {
  await po.setUp({ enableAutoFixProblems: true });
  await po.importApp(MINIMAL_APP);
  await po.expectPreviewIframeIsVisible();

  await po.sendPrompt("tc=create-ts-errors");

  await po.snapshotServerDump("all-messages", { dumpIndex: -2 });
  await po.snapshotServerDump("all-messages", { dumpIndex: -1 });

  await po.snapshotMessages({ replaceDumpPath: true });
});

test("problems auto-fix - gives up after 2 attempts", async ({ po }) => {
  await po.setUp({ enableAutoFixProblems: true });
  await po.importApp(MINIMAL_APP);
  await po.expectPreviewIframeIsVisible();

  await po.sendPrompt("tc=create-unfixable-ts-errors");

  await po.snapshotServerDump("all-messages", { dumpIndex: -2 });
  await po.snapshotServerDump("all-messages", { dumpIndex: -1 });

  await po.page.getByTestId("problem-summary").last().click();
  await expect(
    po.page.getByTestId("problem-summary").last(),
  ).toMatchAriaSnapshot();
  await po.snapshotMessages({ replaceDumpPath: true });
});

test("problems auto-fix - complex delete-rename-write", async ({ po }) => {
  await po.setUp({ enableAutoFixProblems: true });
  await po.importApp(MINIMAL_APP);
  await po.expectPreviewIframeIsVisible();

  await po.sendPrompt("tc=create-ts-errors-complex");

  await po.snapshotServerDump("all-messages", { dumpIndex: -2 });
  await po.snapshotServerDump("all-messages", { dumpIndex: -1 });

  await po.snapshotMessages({ replaceDumpPath: true });
});

test("problems auto-fix - disabled", async ({ po }) => {
  await po.setUp({ enableAutoFixProblems: false });
  await po.importApp(MINIMAL_APP);
  await po.expectPreviewIframeIsVisible();

  await po.sendPrompt("tc=create-ts-errors");

  await po.snapshotMessages();
});

testSkipIfWindows("problems - fix all", async ({ po }) => {
  await po.setUp({ enableAutoFixProblems: true });
  await po.importApp(MINIMAL_APP);
  const appPath = await po.getCurrentAppPath();
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
  await po.ensurePnpmInstall();

  await po.sendPrompt("tc=create-ts-errors");
  await po.selectPreviewMode("problems");
  await po.clickFixAllProblems();

  await po.snapshotServerDump("last-message");
  await po.snapshotMessages({ replaceDumpPath: true });
});

testSkipIfWindows(
  "problems - select specific problems and fix",
  async ({ po }) => {
    await po.setUp();
    await po.importApp(MINIMAL_APP);

    // Create multiple TS errors in one file
    const appPath = await po.getCurrentAppPath();
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

    await po.ensurePnpmInstall();

    // Trigger creation of problems and open problems panel
    // await po.sendPrompt("tc=create-ts-errors");
    await po.selectPreviewMode("problems");
    await po.clickRecheckProblems();

    // Initially, all selected: button shows Fix X problems and Clear all is visible
    const fixButton = po.page.getByTestId("fix-all-button");
    await expect(fixButton).toBeVisible();
    await expect(fixButton).toContainText(/Fix \d+ problems/);

    // Click first two rows to toggle off (deselect)
    const rows = po.page.getByTestId("problem-row");
    const rowCount = await rows.count();
    expect(rowCount).toBeGreaterThan(2);
    await rows.nth(0).click();
    await rows.nth(1).click();

    // Button should update to reflect remaining selected
    await expect(fixButton).toContainText(/Fix 1 problem/);

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
    await expect(fixButton).toContainText(/Fix 2 problems/);

    await fixButton.click();
    await po.waitForChatCompletion();
    await po.snapshotServerDump("last-message");
    await po.snapshotMessages({ replaceDumpPath: true });
  },
);

testSkipIfWindows("problems - manual edit (react/vite)", async ({ po }) => {
  await po.setUp({ enableAutoFixProblems: true });
  await po.sendPrompt("tc=1");

  const appPath = await po.getCurrentAppPath();
  const badFilePath = path.join(appPath, "src", "bad-file.tsx");
  fs.writeFileSync(
    badFilePath,
    `const App = () => <div>Minimal imported app</div>;
nonExistentFunction();    

export default App;
`,
  );
  await po.ensurePnpmInstall();
  await po.clickTogglePreviewPanel();

  await po.selectPreviewMode("problems");
  const fixButton = po.page.getByTestId("fix-all-button");
  await expect(fixButton).toBeEnabled({ timeout: Timeout.LONG });
  await expect(fixButton).toContainText(/Fix 1 problem/);

  fs.unlinkSync(badFilePath);

  await po.clickRecheckProblems();
  await expect(fixButton).toBeDisabled({ timeout: Timeout.LONG });
  await expect(fixButton).toContainText(/Fix 0 problems/);
});

testSkipIfWindows("problems - manual edit (next.js)", async ({ po }) => {
  await po.setUp({ enableAutoFixProblems: true });
  await po.goToHubAndSelectTemplate("Next.js Template");
  await po.sendPrompt("tc=1");

  const appPath = await po.getCurrentAppPath();
  const badFilePath = path.join(appPath, "src", "bad-file.tsx");
  fs.writeFileSync(
    badFilePath,
    `const App = () => <div>Minimal imported app</div>;
  nonExistentFunction();    
  
  export default App;
  `,
  );
  await po.ensurePnpmInstall();
  await po.clickTogglePreviewPanel();

  await po.selectPreviewMode("problems");
  const fixButton = po.page.getByTestId("fix-all-button");
  await expect(fixButton).toBeEnabled({ timeout: Timeout.LONG });
  await expect(fixButton).toContainText(/Fix 1 problem/);

  fs.unlinkSync(badFilePath);

  await po.clickRecheckProblems();
  await expect(fixButton).toBeDisabled({ timeout: Timeout.LONG });
  await expect(fixButton).toContainText(/Fix 0 problems/);
});
