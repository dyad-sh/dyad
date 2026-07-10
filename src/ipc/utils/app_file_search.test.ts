import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  MAX_APP_FILE_SEARCH_FILES,
  MAX_APP_FILE_SEARCH_SNIPPET_BYTES,
  searchAppFilesWithRipgrep,
} from "./app_file_search";

vi.mock("electron-log", () => ({
  default: {
    scope: () => ({ debug: vi.fn(), warn: vi.fn() }),
  },
}));

vi.mock("./ripgrep_utils", () => ({
  getRgExecutablePath: () =>
    path.join(
      process.cwd(),
      "node_modules",
      "@vscode",
      "ripgrep",
      "bin",
      process.platform === "win32" ? "rg.exe" : "rg",
    ),
  MAX_FILE_SEARCH_SIZE: 1024 * 1024,
  RIPGREP_EXCLUDED_GLOBS: ["!node_modules/**", "!.git/**", "!.next/**"],
}));

const tempDirs: string[] = [];

async function makeTempDir() {
  const directory = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), "app-file-search-"),
  );
  tempDirs.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    tempDirs
      .splice(0)
      .map((directory) =>
        fs.promises.rm(directory, { recursive: true, force: true }),
      ),
  );
});

describe("searchAppFilesWithRipgrep", () => {
  it("stops the producer when a broad search reaches the file cap", async () => {
    const directory = await makeTempDir();
    await Promise.all(
      Array.from({ length: MAX_APP_FILE_SEARCH_FILES + 25 }, (_, index) =>
        fs.promises.writeFile(
          path.join(
            directory,
            `match-${index.toString().padStart(3, "0")}.txt`,
          ),
          "broad-search-needle\n",
        ),
      ),
    );

    const results = await searchAppFilesWithRipgrep({
      appPath: directory,
      query: "broad-search-needle",
    });

    expect(results).toHaveLength(MAX_APP_FILE_SEARCH_FILES);
    expect(results.every((result) => result.truncated)).toBe(true);
  });

  it("caps a Unicode snippet by UTF-8 bytes", async () => {
    const directory = await makeTempDir();
    await fs.promises.writeFile(
      path.join(directory, "unicode.txt"),
      `${"😀".repeat(2_000)}needle${"界".repeat(2_000)}\n`,
    );

    const [result] = await searchAppFilesWithRipgrep({
      appPath: directory,
      query: "needle",
    });
    const snippet = result.snippets?.[0];
    const snippetBytes = Buffer.byteLength(
      `${snippet?.before}${snippet?.match}${snippet?.after}`,
      "utf8",
    );

    expect(snippetBytes).toBeLessThanOrEqual(MAX_APP_FILE_SEARCH_SNIPPET_BYTES);
    expect(
      `${snippet?.before}${snippet?.match}${snippet?.after}`,
    ).not.toContain("�");
  });

  it("does not mark an ordinary result as truncated", async () => {
    const directory = await makeTempDir();
    await fs.promises.writeFile(path.join(directory, "one.txt"), "needle\n");

    const results = await searchAppFilesWithRipgrep({
      appPath: directory,
      query: "needle",
    });

    expect(results).toHaveLength(1);
    expect(results[0].truncated).toBeUndefined();
  });
});
