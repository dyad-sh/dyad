import fs from "fs";

import { expect } from "@playwright/test";

import { test, type PageObject } from "./helpers/test_helper";

type DumpContentPart = {
  text?: string;
};

type DumpMessage = {
  role: string;
  content: string | DumpContentPart[];
};

type DumpFileReference = {
  path: string;
  force?: boolean;
};

type DumpJson = {
  body: {
    input?: DumpMessage[];
    messages?: DumpMessage[];
    dyad_options?: {
      enable_smart_files_context?: boolean;
      smart_context_mode?: string;
      files?: DumpFileReference[];
      versioned_files?: {
        fileReferences?: DumpFileReference[];
      };
    };
  };
};

const FULL_CODEBASE_PATHS = [
  ".env.foobar",
  "AI_RULES.md",
  "a.ts",
  "exclude/exclude.ts",
  "exclude/exclude.tsx",
  "manual/baz.json",
  "manual/file.ts",
  "manual/sub-manual/sub-manual.js",
  "src/components/ui/button.tsx",
  "src/components/ui/helper.ts",
  "src/dir/some.css",
  "src/foo.ts",
  "src/sub/sub1.ts",
  "src/sub/sub2.tsx",
  "src/very-large-file.ts",
];

const MANUAL_SRC_CONTEXT_PATHS = [
  "src/components/ui/helper.ts",
  "src/foo.ts",
  "src/sub/sub1.ts",
  "src/sub/sub2.tsx",
  "src/very-large-file.ts",
];

const MANUAL_AND_SMART_CONTEXT_PATHS = [
  "a.ts",
  "manual/baz.json",
  "manual/file.ts",
  "manual/sub-manual/sub-manual.js",
  ...MANUAL_SRC_CONTEXT_PATHS,
];

const FORCED_AUTO_INCLUDE_PATHS = [
  "a.ts",
  "manual/baz.json",
  "manual/file.ts",
  "manual/sub-manual/sub-manual.js",
];

const FORCED_SMART_EXCLUDE_PATHS = ["a.ts", "exclude/exclude.tsx"];

async function readDump(po: PageObject, dumpIndex = -1): Promise<DumpJson> {
  await po.chatActions.waitForChatCompletion();
  await expect(po.page.getByTestId("messages-list")).toContainText(
    "[[dyad-dump-path=",
  );

  const messagesListText = await po.page
    .getByTestId("messages-list")
    .textContent();
  const dumpPathMatches = [
    ...(messagesListText?.matchAll(/\[\[dyad-dump-path=([^\]]+)\]\]/g) ?? []),
  ];
  const selectedIndex =
    dumpIndex < 0 ? dumpPathMatches.length + dumpIndex : dumpIndex;
  const dumpMatch = dumpPathMatches[selectedIndex];

  expect(dumpMatch?.[1]).toBeTruthy();

  return JSON.parse(fs.readFileSync(dumpMatch![1], "utf-8")) as DumpJson;
}

function getMessageText(content: DumpMessage["content"]): string {
  if (typeof content === "string") {
    return content;
  }

  return content.map((part) => part.text ?? "").join("\n");
}

function getIncludedFiles(dump: DumpJson): DumpFileReference[] {
  const versionedFiles =
    dump.body.dyad_options?.versioned_files?.fileReferences;
  if (versionedFiles?.length) {
    return versionedFiles;
  }

  const files = dump.body.dyad_options?.files;
  if (files?.length) {
    return files;
  }

  const messages = dump.body.input ?? dump.body.messages ?? [];
  const messagePaths = messages.flatMap(({ content }) =>
    [...getMessageText(content).matchAll(/<dyad-file path="([^"]+)">/g)].map(
      (match) => match[1],
    ),
  );

  return [...new Set(messagePaths)].map((path) => ({ path, force: false }));
}

function getIncludedPaths(dump: DumpJson): string[] {
  return getIncludedFiles(dump)
    .map(({ path }) => path)
    .sort();
}

function getForcedPaths(dump: DumpJson): string[] {
  return getIncludedFiles(dump)
    .filter(({ force }) => force)
    .map(({ path }) => path)
    .sort();
}

function expectIncludedPaths(dump: DumpJson, expectedPaths: string[]) {
  expect(getIncludedPaths(dump)).toEqual([...expectedPaths].sort());
}

function expectForcedPaths(dump: DumpJson, expectedPaths: string[]) {
  expect(getForcedPaths(dump)).toEqual([...expectedPaths].sort());
}

async function expectVisiblePaths(po: PageObject, paths: string[]) {
  const dialog = po.page.getByRole("dialog");
  for (const path of paths) {
    await expect(dialog.getByText(path, { exact: true })).toBeVisible();
  }
}

async function expectAbsentPaths(po: PageObject, paths: string[]) {
  const dialog = po.page.getByRole("dialog");
  for (const path of paths) {
    await expect(dialog.getByText(path, { exact: true })).toHaveCount(0);
  }
}

async function addPathAndWait(
  po: PageObject,
  addPath: () => Promise<void>,
  path: string,
) {
  await addPath();
  await expectVisiblePaths(po, [path]);
}

async function removeFirstPath(po: PageObject, removeButtonTestId: string) {
  const removeButtons = po.page.getByTestId(removeButtonTestId);
  const initialCount = await removeButtons.count();

  expect(initialCount).toBeGreaterThan(0);
  await removeButtons.first().click();
  await expect(removeButtons).toHaveCount(initialCount - 1);
}

async function removeAllPaths(po: PageObject, removeButtonTestId: string) {
  while ((await po.page.getByTestId(removeButtonTestId).count()) > 0) {
    await removeFirstPath(po, removeButtonTestId);
  }
}

test("manage context - default", async ({ po }) => {
  await po.setUp();
  await po.importApp("context-manage");

  const dialog = await po.openContextFilesPicker();
  await expect(po.page.getByRole("dialog")).toContainText(
    "Dyad will use the entire codebase as context.",
  );
  await addPathAndWait(
    po,
    () => dialog.addManualContextFile("DELETETHIS"),
    "DELETETHIS",
  );
  await removeFirstPath(po, "manual-context-files-remove-button");
  await addPathAndWait(
    po,
    () => dialog.addManualContextFile("src/**/*.ts"),
    "src/**/*.ts",
  );
  await addPathAndWait(
    po,
    () => dialog.addManualContextFile("src/sub/**"),
    "src/sub/**",
  );
  await expectVisiblePaths(po, ["src/**/*.ts", "src/sub/**"]);
  await expectAbsentPaths(po, ["DELETETHIS"]);
  await expect(
    po.page.getByTestId("manual-context-files-remove-button"),
  ).toHaveCount(2);
  await dialog.close();

  await po.sendPrompt("[dump]");

  expectIncludedPaths(await readDump(po), MANUAL_SRC_CONTEXT_PATHS);
});

test("manage context - smart context", async ({ po }) => {
  await po.setUpDyadPro();
  await po.modelPicker.selectModel({
    provider: "Google",
    model: "Gemini 2.5 Pro",
  });
  await po.importApp("context-manage");

  let dialog = await po.openContextFilesPicker();
  await expect(po.page.getByRole("dialog")).toContainText(
    "Dyad will use Smart Context to automatically find the most relevant files to use as context.",
  );
  await expect(po.page.getByRole("dialog")).toContainText(
    "Smart Context Auto-includes",
  );

  await addPathAndWait(
    po,
    () => dialog.addManualContextFile("src/**/*.ts"),
    "src/**/*.ts",
  );
  await addPathAndWait(
    po,
    () => dialog.addManualContextFile("src/sub/**"),
    "src/sub/**",
  );
  await addPathAndWait(
    po,
    () => dialog.addAutoIncludeContextFile("a.ts"),
    "a.ts",
  );
  await addPathAndWait(
    po,
    () => dialog.addAutoIncludeContextFile("manual/**"),
    "manual/**",
  );
  await expectVisiblePaths(po, [
    "src/**/*.ts",
    "src/sub/**",
    "a.ts",
    "manual/**",
  ]);
  await expect(
    po.page.getByTestId("manual-context-files-remove-button"),
  ).toHaveCount(2);
  await expect(
    po.page.getByTestId("auto-include-context-files-remove-button"),
  ).toHaveCount(2);
  await dialog.close();

  await po.sendPrompt("[dump]");

  const smartContextDump = await readDump(po);
  expect(smartContextDump.body.dyad_options?.enable_smart_files_context).toBe(
    true,
  );
  expect(smartContextDump.body.dyad_options?.smart_context_mode).toBe("deep");
  expectIncludedPaths(smartContextDump, MANUAL_AND_SMART_CONTEXT_PATHS);
  expectForcedPaths(smartContextDump, FORCED_AUTO_INCLUDE_PATHS);

  // Disabling smart context will automatically disable
  // the auto-includes.
  const proModesDialog = await po.openProModesDialog();
  await proModesDialog.setSmartContextMode("off");
  await proModesDialog.close();

  await po.sendPrompt("[dump]");
  const balancedDump = await readDump(po);
  expect(balancedDump.body.dyad_options?.enable_smart_files_context).toBe(
    false,
  );
  expect(balancedDump.body.dyad_options?.smart_context_mode).toBe("balanced");
  expectIncludedPaths(balancedDump, MANUAL_SRC_CONTEXT_PATHS);

  // Removing manual context files will result in all files being included.
  dialog = await po.openContextFilesPicker();
  await removeAllPaths(po, "manual-context-files-remove-button");
  await expect(
    po.page.getByTestId("manual-context-files-remove-button"),
  ).toHaveCount(0);
  await expect(
    po.page.getByTestId("auto-include-context-files-remove-button"),
  ).toHaveCount(0);
  await dialog.close();

  await po.sendPrompt("[dump]");
  const fullCodebaseDump = await readDump(po);
  expect(fullCodebaseDump.body.dyad_options?.enable_smart_files_context).toBe(
    false,
  );
  expectIncludedPaths(fullCodebaseDump, FULL_CODEBASE_PATHS);
});

test("manage context - smart context - auto-includes only", async ({ po }) => {
  await po.setUpDyadPro();
  await po.modelPicker.selectModel({
    provider: "Google",
    model: "Gemini 2.5 Pro",
  });
  await po.importApp("context-manage");

  const dialog = await po.openContextFilesPicker();
  await expect(po.page.getByRole("dialog")).toContainText(
    "Smart Context Auto-includes",
  );

  await addPathAndWait(
    po,
    () => dialog.addAutoIncludeContextFile("a.ts"),
    "a.ts",
  );
  await addPathAndWait(
    po,
    () => dialog.addAutoIncludeContextFile("manual/**"),
    "manual/**",
  );
  await expectVisiblePaths(po, ["a.ts", "manual/**"]);
  await expect(
    po.page.getByTestId("auto-include-context-files-remove-button"),
  ).toHaveCount(2);
  await dialog.close();

  await po.sendPrompt("[dump]");

  const dump = await readDump(po);
  expect(dump.body.dyad_options?.enable_smart_files_context).toBe(true);
  expect(dump.body.dyad_options?.smart_context_mode).toBe("deep");
  expectForcedPaths(dump, FORCED_AUTO_INCLUDE_PATHS);
});

test("manage context - exclude paths", async ({ po }) => {
  await po.setUp();
  await po.importApp("context-manage");

  const dialog = await po.openContextFilesPicker();
  await expect(po.page.getByRole("dialog")).toContainText("Exclude Paths");

  // Add some include paths first
  await addPathAndWait(
    po,
    () => dialog.addManualContextFile("src/**/*.ts"),
    "src/**/*.ts",
  );
  await addPathAndWait(
    po,
    () => dialog.addManualContextFile("manual/**"),
    "manual/**",
  );

  // Add exclude paths
  await addPathAndWait(
    po,
    () => dialog.addExcludeContextFile("src/components/**"),
    "src/components/**",
  );
  await addPathAndWait(
    po,
    () => dialog.addExcludeContextFile("manual/exclude/**"),
    "manual/exclude/**",
  );
  await expectVisiblePaths(po, [
    "src/**/*.ts",
    "manual/**",
    "src/components/**",
    "manual/exclude/**",
  ]);
  await expect(
    po.page.getByTestId("manual-context-files-remove-button"),
  ).toHaveCount(2);
  await expect(
    po.page.getByTestId("exclude-context-files-remove-button"),
  ).toHaveCount(2);
  await dialog.close();

  await po.sendPrompt("[dump]");
  expectIncludedPaths(await readDump(po), [
    "manual/baz.json",
    "manual/file.ts",
    "manual/sub-manual/sub-manual.js",
    "src/foo.ts",
    "src/sub/sub1.ts",
    "src/very-large-file.ts",
  ]);

  // Test that exclude paths take precedence over include paths
  const dialog2 = await po.openContextFilesPicker();
  await removeFirstPath(po, "exclude-context-files-remove-button"); // Remove src/components/**
  await addPathAndWait(
    po,
    () => dialog2.addExcludeContextFile("src/**"),
    "src/**",
  ); // This should exclude everything from src
  await expectVisiblePaths(po, ["manual/**", "manual/exclude/**", "src/**"]);
  await expectAbsentPaths(po, ["src/components/**"]);
  await dialog2.close();

  await po.sendPrompt("[dump]");
  expectIncludedPaths(await readDump(po), [
    "manual/baz.json",
    "manual/file.ts",
    "manual/sub-manual/sub-manual.js",
  ]);
});

test("manage context - exclude paths with smart context", async ({ po }) => {
  await po.setUpDyadPro();
  await po.modelPicker.selectModel({
    provider: "Google",
    model: "Gemini 2.5 Pro",
  });
  await po.importApp("context-manage");

  const dialog = await po.openContextFilesPicker();
  await expect(po.page.getByRole("dialog")).toContainText("Exclude Paths");

  // Add manual context files
  await addPathAndWait(
    po,
    () => dialog.addManualContextFile("src/**/*.ts"),
    "src/**/*.ts",
  );
  await addPathAndWait(
    po,
    () => dialog.addManualContextFile("manual/**"),
    "manual/**",
  );

  // Add smart context auto-includes
  await addPathAndWait(
    po,
    () => dialog.addAutoIncludeContextFile("a.ts"),
    "a.ts",
  );
  await addPathAndWait(
    po,
    () => dialog.addAutoIncludeContextFile("exclude/**"),
    "exclude/**",
  );

  // Add exclude paths that should filter out some of the above
  await addPathAndWait(
    po,
    () => dialog.addExcludeContextFile("src/components/**"),
    "src/components/**",
  );
  await addPathAndWait(
    po,
    () => dialog.addExcludeContextFile("exclude/exclude.ts"),
    "exclude/exclude.ts",
  );
  await expectVisiblePaths(po, [
    "src/**/*.ts",
    "manual/**",
    "a.ts",
    "exclude/**",
    "src/components/**",
    "exclude/exclude.ts",
  ]);
  await dialog.close();

  await po.sendPrompt("[dump]");
  const dump = await readDump(po);
  const includedPaths = getIncludedPaths(dump);

  expect(dump.body.dyad_options?.enable_smart_files_context).toBe(true);
  expect(includedPaths).toEqual(
    expect.arrayContaining([
      "a.ts",
      "exclude/exclude.tsx",
      "manual/baz.json",
      "manual/file.ts",
      "manual/sub-manual/sub-manual.js",
      "src/foo.ts",
      "src/sub/sub1.ts",
      "src/very-large-file.ts",
    ]),
  );
  expect(getForcedPaths(dump)).toEqual(
    expect.arrayContaining(FORCED_SMART_EXCLUDE_PATHS),
  );
  expect(includedPaths).not.toContain("exclude/exclude.ts");
  expect(includedPaths).not.toContain("src/components/ui/helper.ts");
});
