import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import {
  assertAppFolderExists,
  assertAppGitRepository,
} from "./app_git_repository";
import { safeGithubOpsErrorMessage } from "@/ipc/services/github_ops_safe_error";

async function captureError(appPath: string): Promise<DyadError> {
  const error = await assertAppGitRepository(appPath).then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(DyadError);
  return error as DyadError;
}

function errnoError(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(code), { code });
}

describe("assertAppGitRepository", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "app-git-repo-"));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("resolves when the app folder contains a .git directory", async () => {
    fs.mkdirSync(path.join(tmpDir, ".git"));
    await expect(assertAppGitRepository(tmpDir)).resolves.toBeUndefined();
  });

  it("resolves when .git is a file (worktree or submodule)", async () => {
    fs.writeFileSync(path.join(tmpDir, ".git"), "gitdir: ../elsewhere\n");
    await expect(assertAppGitRepository(tmpDir)).resolves.toBeUndefined();
  });

  it("reports a real non-git folder as not a git repository", async () => {
    const error = await captureError(tmpDir);
    expect(error.message).toBe("Not a git repository");
    expect(error.kind).toBe(DyadErrorKind.External);
  });

  it("reports a missing app folder as not found", async () => {
    const appPath = path.join(tmpDir, "deleted-app");
    const error = await captureError(appPath);
    expect(error.message).toContain(`App folder not found: '${appPath}'`);
    expect(error.kind).toBe(DyadErrorKind.NotFound);
  });

  it("reports an unavailable parent location (e.g. unmounted drive)", async () => {
    const parentDir = path.join(tmpDir, "unmounted-drive");
    const error = await captureError(path.join(parentDir, "my-app"));
    expect(error.message).toContain(`location '${parentDir}' is unavailable`);
    expect(error.kind).toBe(DyadErrorKind.NotFound);
  });

  it("reports a file at the app path as a missing folder", async () => {
    const filePath = path.join(tmpDir, "not-a-dir");
    fs.writeFileSync(filePath, "");
    const error = await captureError(filePath);
    expect(error.message).toContain(`App folder not found: '${filePath}'`);
    expect(error.kind).toBe(DyadErrorKind.NotFound);
  });

  // Creating symlinks on Windows can require extra privileges.
  it.skipIf(process.platform === "win32")(
    "reports a broken .git symlink in an existing folder as not a git repository",
    async () => {
      const blocker = path.join(tmpDir, "blocker-file");
      fs.writeFileSync(blocker, "");
      // `stat` on this link fails with ENOTDIR while the app folder is fine.
      fs.symlinkSync(path.join(blocker, "repo"), path.join(tmpDir, ".git"));
      const error = await captureError(tmpDir);
      expect(error.message).toBe("Not a git repository");
      expect(error.kind).toBe(DyadErrorKind.External);
    },
  );

  it.each(["EACCES", "EPERM"])(
    "reports %s on the app folder as a permission problem",
    async (code) => {
      const appPath = path.join(tmpDir, "locked-app");
      const statSpy = vi
        .spyOn(fs.promises, "stat")
        .mockImplementation(((target: fs.PathLike) =>
          Promise.reject(
            errnoError(String(target) === appPath ? code : "ENOENT"),
          )) as typeof fs.promises.stat);
      const error = await captureError(appPath);
      expect(statSpy).toHaveBeenCalledWith(appPath);
      expect(error.message).toContain("doesn't have permission");
      expect(error.message).toContain(appPath);
      expect(error.kind).toBe(DyadErrorKind.Precondition);
    },
  );

  it("reports a permission error that only affects .git", async () => {
    const realStat = fs.promises.stat;
    vi.spyOn(fs.promises, "stat").mockImplementation(((target: fs.PathLike) =>
      String(target).endsWith(".git")
        ? Promise.reject(errnoError("EACCES"))
        : realStat(target)) as typeof fs.promises.stat);
    const error = await captureError(tmpDir);
    expect(error.kind).toBe(DyadErrorKind.Precondition);
  });

  it("falls back to not a git repository for unexpected stat errors", async () => {
    vi.spyOn(fs.promises, "stat").mockRejectedValue(errnoError("EIO"));
    const error = await captureError(path.join(tmpDir, "flaky-app"));
    expect(error.message).toBe("Not a git repository");
    expect(error.kind).toBe(DyadErrorKind.External);
  });

  it("keeps messages readable after GitHub ops path redaction", async () => {
    const missing = await captureError(path.join(tmpDir, "deleted-app"));
    const unavailable = await captureError(
      path.join(tmpDir, "unmounted-drive", "my-app"),
    );
    vi.spyOn(fs.promises, "stat").mockRejectedValue(errnoError("EACCES"));
    const denied = await captureError(path.join(tmpDir, "locked-app"));

    expect(safeGithubOpsErrorMessage(missing, "")).toBe(
      "App folder not found: '[redacted path]'. It may have been moved or deleted.",
    );
    for (const error of [unavailable, denied]) {
      const redacted = safeGithubOpsErrorMessage(error, "");
      expect(redacted).toContain("'[redacted path]'");
      expect(redacted).not.toContain("path remainder redacted");
      expect(redacted).toMatch(
        /drive is connected\.$|Privacy & Security settings\)\.$/,
      );
    }
  });

  it.each([
    // Windows doesn't allow double quotes in folder names.
    ...(process.platform === "win32" ? [] : ['My "private-project"']),
    "John's Projects",
    "it's a 'secret' dir",
  ])(
    "redacts the whole path when a folder name contains quotes (%s)",
    async (folderName) => {
      const appPath = path.join(tmpDir, folderName, "deleted-app");
      fs.mkdirSync(path.dirname(appPath));
      const error = await captureError(appPath);
      expect(safeGithubOpsErrorMessage(error, "")).toBe(
        "App folder not found: '[redacted path]'. It may have been moved or deleted.",
      );
    },
  );
});

describe("assertAppFolderExists", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "app-folder-exists-"));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  async function folderError(appPath: string): Promise<DyadError> {
    const error = await assertAppFolderExists(appPath).then(
      () => null,
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(DyadError);
    return error as DyadError;
  }

  it("resolves for an existing folder, even without .git", async () => {
    await expect(assertAppFolderExists(tmpDir)).resolves.toBeUndefined();
  });

  it("reports a file at the app path as a missing folder", async () => {
    const appPath = path.join(tmpDir, "replaced-by-file");
    fs.writeFileSync(appPath, "");
    const error = await folderError(appPath);
    expect(error.message).toContain(`App folder not found: '${appPath}'`);
    expect(error.kind).toBe(DyadErrorKind.NotFound);
  });

  it("reports a missing app folder as not found", async () => {
    const appPath = path.join(tmpDir, "deleted-app");
    const error = await folderError(appPath);
    expect(error.message).toContain(`App folder not found: '${appPath}'`);
    expect(error.kind).toBe(DyadErrorKind.NotFound);
  });

  it("reports an unavailable parent location", async () => {
    const parentDir = path.join(tmpDir, "unmounted-drive");
    const error = await folderError(path.join(parentDir, "my-app"));
    expect(error.message).toContain(`location '${parentDir}' is unavailable`);
    expect(error.kind).toBe(DyadErrorKind.NotFound);
  });

  it.each(["EACCES", "EPERM"])(
    "reports a folder that can't be opened (%s) as a permission problem",
    async (code) => {
      const accessSpy = vi
        .spyOn(fs.promises, "access")
        .mockRejectedValue(errnoError(code));
      const error = await folderError(tmpDir);
      expect(accessSpy).toHaveBeenCalledWith(
        tmpDir,
        fs.constants.R_OK | fs.constants.X_OK,
      );
      expect(error.message).toContain("doesn't have permission");
      expect(error.kind).toBe(DyadErrorKind.Precondition);
    },
  );

  it("reports a permission error as a precondition", async () => {
    vi.spyOn(fs.promises, "stat").mockRejectedValue(errnoError("EPERM"));
    const error = await folderError(path.join(tmpDir, "locked-app"));
    expect(error.kind).toBe(DyadErrorKind.Precondition);
  });

  it("reports unexpected stat errors with their code", async () => {
    vi.spyOn(fs.promises, "stat").mockRejectedValue(errnoError("EIO"));
    const error = await folderError(path.join(tmpDir, "flaky-app"));
    expect(error.message).toContain("(EIO)");
    expect(error.kind).toBe(DyadErrorKind.External);
  });
});
