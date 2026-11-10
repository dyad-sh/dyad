// @vitest-environment node
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { readSettings } = vi.hoisted(() => ({ readSettings: vi.fn() }));

vi.mock("electron-log", () => ({
  default: {
    scope: () => ({ log: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  },
}));
vi.mock("@/main/settings", () => ({ readSettings }));

import { ensureDyadGitignored } from "./gitignoreUtils";

describe("ensureDyadGitignored", () => {
  let appPath: string;
  let gitignorePath: string;

  beforeEach(async () => {
    readSettings.mockReturnValue({ enableWorktreeIsolation: false });
    appPath = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), "dyad-gitignore-"),
    );
    gitignorePath = path.join(appPath, ".gitignore");
  });

  afterEach(async () => {
    if (process.platform === "win32") {
      execFileSync("attrib.exe", ["-H", "-S", "-R", gitignorePath]);
    }
    await fs.promises.rm(appPath, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it("creates a missing .gitignore", async () => {
    await ensureDyadGitignored(appPath);
    expect(await fs.promises.readFile(gitignorePath, "utf8")).toBe(".dyad/\n");
  });

  it("preserves existing entries and adds a missing newline", async () => {
    await fs.promises.writeFile(gitignorePath, "node_modules\r\ndist");
    await ensureDyadGitignored(appPath);
    expect(await fs.promises.readFile(gitignorePath, "utf8")).toBe(
      "node_modules\r\ndist\n.dyad/\n",
    );
    await ensureDyadGitignored(appPath);
    expect(await fs.promises.readFile(gitignorePath, "utf8")).toBe(
      "node_modules\r\ndist\n.dyad/\n",
    );
  });

  it.skipIf(process.platform !== "win32").each(["H", "S"])(
    "updates an existing Windows file with the %s attribute",
    async (attribute) => {
      await fs.promises.writeFile(gitignorePath, "node_modules\n");
      execFileSync("attrib.exe", [`+${attribute}`, gitignorePath]);
      await ensureDyadGitignored(appPath);
      expect(await fs.promises.readFile(gitignorePath, "utf8")).toBe(
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
      await fs.promises.writeFile(gitignorePath, "node_modules\n");
      execFileSync("attrib.exe", ["+R", gitignorePath]);
      await expect(ensureDyadGitignored(appPath)).rejects.toMatchObject({
        code: "EPERM",
      });
      expect(await fs.promises.readFile(gitignorePath, "utf8")).toBe(
        "node_modules\n",
      );
    },
  );
});

describe("ensureDyadGitignored in a Git repository", () => {
  let appPath: string;

  beforeEach(async () => {
    appPath = await fs.promises.mkdtemp(path.join(os.tmpdir(), "dyad-ignore-"));
    execFileSync("git", ["init", "-q"], { cwd: appPath });
    await fs.promises.writeFile(path.join(appPath, ".gitignore"), "dist\n");
    execFileSync("git", ["add", "-A"], { cwd: appPath });
    execFileSync(
      "git",
      [
        "-c",
        "user.name=Test",
        "-c",
        "user.email=test@example.com",
        "commit",
        "-q",
        "-m",
        "init",
      ],
      { cwd: appPath },
    );
  });

  afterEach(async () => {
    await fs.promises.rm(appPath, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 100,
    });
    vi.clearAllMocks();
  });

  function readExclude(): string {
    return fs.readFileSync(
      path.join(appPath, ".git", "info", "exclude"),
      "utf8",
    );
  }

  it("adds .dyad/ to .gitignore when worktree isolation is off", async () => {
    readSettings.mockReturnValue({ enableWorktreeIsolation: false });

    await ensureDyadGitignored(appPath);

    expect(
      await fs.promises.readFile(path.join(appPath, ".gitignore"), "utf8"),
    ).toBe("dist\n.dyad/\n");
  });

  it("excludes .dyad/ through the repository when isolation is on", async () => {
    readSettings.mockReturnValue({ enableWorktreeIsolation: true });

    await ensureDyadGitignored(appPath);

    // The app's folder keeps no uncommitted .gitignore change for chats
    // that commit only in their worktrees.
    expect(
      await fs.promises.readFile(path.join(appPath, ".gitignore"), "utf8"),
    ).toBe("dist\n");
    expect(readExclude()).toContain(".dyad/");
    await fs.promises.mkdir(path.join(appPath, ".dyad"));
    await fs.promises.writeFile(path.join(appPath, ".dyad", "a.md"), "x\n");
    expect(
      execFileSync("git", ["status", "--porcelain"], {
        cwd: appPath,
        encoding: "utf8",
      }),
    ).toBe("");
  });

  it("excludes .dyad/ for an app in a subfolder of its repository", async () => {
    readSettings.mockReturnValue({ enableWorktreeIsolation: true });
    const nestedApp = path.join(appPath, "apps", "web");
    await fs.promises.mkdir(nestedApp, { recursive: true });
    await fs.promises.writeFile(path.join(nestedApp, ".gitignore"), "dist\n");

    await ensureDyadGitignored(nestedApp);

    expect(
      await fs.promises.readFile(path.join(nestedApp, ".gitignore"), "utf8"),
    ).toBe("dist\n");
    expect(readExclude()).toContain(".dyad/");

    // Once excluded, it stays out of every .gitignore, isolation on or off.
    readSettings.mockReturnValue({ enableWorktreeIsolation: false });
    await ensureDyadGitignored(nestedApp);
    expect(
      await fs.promises.readFile(path.join(nestedApp, ".gitignore"), "utf8"),
    ).toBe("dist\n");
  });
});
