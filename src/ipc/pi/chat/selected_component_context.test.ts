import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildSelectedComponentContext } from "./selected_component_context";

describe("buildSelectedComponentContext", () => {
  let appPath: string;

  beforeEach(async () => {
    appPath = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), "dyad-selected-component-"),
    );
  });

  afterEach(async () => {
    await fs.promises.rm(appPath, { recursive: true, force: true });
  });

  it("includes a bounded excerpt and marks the selected line", async () => {
    await fs.promises.writeFile(
      path.join(appPath, "Component.tsx"),
      ["line 1", "line 2", "line 3", "line 4", "line 5", "line 6"].join("\n"),
    );

    const result = await buildSelectedComponentContext(appPath, [
      {
        id: "component-1",
        name: "Card",
        relativePath: "Component.tsx",
        lineNumber: 3,
        columnNumber: 0,
      },
    ]);

    expect(result).toContain('Component: "Card"');
    expect(result).toContain('File: "Component.tsx"');
    expect(result).toContain(">     3 | line 3");
    expect(result).not.toContain("line 1");
    expect(result).toContain("line 6");
  });

  it("bounds minified source lines and does not use Markdown fences", async () => {
    await fs.promises.writeFile(
      path.join(appPath, "minified.js"),
      "x".repeat(20_000),
    );

    const result = await buildSelectedComponentContext(appPath, [
      {
        id: "component-1",
        name: "Minified",
        relativePath: "minified.js",
        lineNumber: 1,
        columnNumber: 0,
      },
    ]);

    expect(result.length).toBeLessThan(2_000);
    expect(result).toContain("[truncated]");
    expect(result).not.toContain("```");
  });

  it("uses a placeholder when the selected file no longer exists", async () => {
    const result = await buildSelectedComponentContext(appPath, [
      {
        id: "component-1",
        name: "Missing",
        relativePath: "missing.tsx",
        lineNumber: 1,
        columnNumber: 0,
      },
    ]);

    expect(result).toContain("[source excerpt unavailable]");
  });

  it("rejects paths outside the app", async () => {
    await expect(
      buildSelectedComponentContext(appPath, [
        {
          id: "component-1",
          name: "Unsafe",
          relativePath: "../outside.tsx",
          lineNumber: 1,
          columnNumber: 0,
        },
      ]),
    ).rejects.toThrow("would escape the base directory");
  });

  it.runIf(process.platform !== "win32")(
    "rejects symlinks that escape the app",
    async () => {
      const outsidePath = await fs.promises.mkdtemp(
        path.join(os.tmpdir(), "dyad-selected-component-outside-"),
      );
      try {
        const outsideFile = path.join(outsidePath, "outside.tsx");
        await fs.promises.writeFile(outsideFile, "external source");
        await fs.promises.symlink(
          outsideFile,
          path.join(appPath, "linked.tsx"),
        );

        await expect(
          buildSelectedComponentContext(appPath, [
            {
              id: "component-1",
              name: "Unsafe",
              relativePath: "linked.tsx",
              lineNumber: 1,
              columnNumber: 0,
            },
          ]),
        ).rejects.toThrow("Cannot read files outside the app");
      } finally {
        await fs.promises.rm(outsidePath, { recursive: true, force: true });
      }
    },
  );
});
