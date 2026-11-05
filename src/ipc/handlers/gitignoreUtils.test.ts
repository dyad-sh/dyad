// @vitest-environment node
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ensureDyadGitignored } from "./gitignoreUtils";

describe("ensureDyadGitignored", () => {
  let appPath: string;
  let gitignorePath: string;

  beforeEach(async () => {
    appPath = await fs.mkdtemp(path.join(os.tmpdir(), "dyad-gitignore-"));
    gitignorePath = path.join(appPath, ".gitignore");
  });

  afterEach(async () => {
    if (process.platform === "win32") {
      execFileSync("attrib.exe", ["-H", "-S", "-R", gitignorePath]);
    }
    await fs.rm(appPath, { recursive: true, force: true });
  });

  it("creates a missing .gitignore", async () => {
    await ensureDyadGitignored(appPath);
    expect(await fs.readFile(gitignorePath, "utf8")).toBe(".dyad/\n");
  });

  it("preserves existing entries and adds a missing newline", async () => {
    await fs.writeFile(gitignorePath, "node_modules\r\ndist");
    await ensureDyadGitignored(appPath);
    expect(await fs.readFile(gitignorePath, "utf8")).toBe(
      "node_modules\r\ndist\n.dyad/\n",
    );
    await ensureDyadGitignored(appPath);
    expect(await fs.readFile(gitignorePath, "utf8")).toBe(
      "node_modules\r\ndist\n.dyad/\n",
    );
  });

  it.skipIf(process.platform !== "win32").each(["H", "S"])(
    "updates an existing Windows file with the %s attribute",
    async (attribute) => {
      await fs.writeFile(gitignorePath, "node_modules\n");
      execFileSync("attrib.exe", [`+${attribute}`, gitignorePath]);
      await ensureDyadGitignored(appPath);
      expect(await fs.readFile(gitignorePath, "utf8")).toBe(
        "node_modules\n.dyad/\n",
      );
      const attributes = execFileSync("attrib.exe", [gitignorePath], {
        encoding: "utf8",
      }).split(gitignorePath)[0];
      expect(attributes).toContain(attribute);
    },
  );

  it.skipIf(process.platform !== "win32")(
    "continues to reject writes to a read-only file",
    async () => {
      await fs.writeFile(gitignorePath, "node_modules\n");
      execFileSync("attrib.exe", ["+R", gitignorePath]);
      await expect(ensureDyadGitignored(appPath)).rejects.toMatchObject({
        code: "EPERM",
      });
      expect(await fs.readFile(gitignorePath, "utf8")).toBe("node_modules\n");
    },
  );
});
