import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ userDataPath: "" }));
vi.mock("@/paths/paths", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/paths/paths")>()),
  getUserDataPath: () => h.userDataPath,
  getTypeScriptCachePath: () => path.join(h.userDataPath, "typescript-cache"),
}));
vi.mock("@/ipc/processors/tsc", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/ipc/processors/tsc")>()),
  runTypeScriptCheck: vi.fn(async () => ({ problems: [] })),
}));
vi.mock("./isolated_package_install", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./isolated_package_install")>()),
  runCleanPackageInstall: vi.fn(async () => ({
    code: 0,
    stdout: "",
    stderr: "",
    aborted: false,
    timedOut: false,
  })),
}));
vi.mock("@/ipc/utils/spawn_streaming", () => ({
  spawnStreaming: vi.fn(),
}));

import {
  runTypeScriptCheck,
  TypeCheckPreconditionError,
} from "@/ipc/processors/tsc";
import { spawnStreaming } from "@/ipc/utils/spawn_streaming";
import { runCleanPackageInstall } from "./isolated_package_install";
import { validateWorkspace } from "./workspace_validation";

function git(cwd: string, ...args: string[]): string {
  return execFileSync(
    "git",
    ["-c", "user.name=Test", "-c", "user.email=test@example.com", ...args],
    { cwd },
  )
    .toString()
    .trim();
}

describe("workspace validation isolation", () => {
  let root: string;
  let repo: string;
  let workspace: string;

  beforeEach(async () => {
    root = await fs.realpath(
      await fs.mkdtemp(path.join(os.tmpdir(), "dyad-validation-")),
    );
    h.userDataPath = path.join(root, "userData");
    repo = path.join(root, "app");
    workspace = path.join(root, "chat");
    await fs.mkdir(repo);
    git(repo, "init", "-b", "main");
  });

  afterEach(async () => {
    vi.clearAllMocks();
    await fs.rm(root, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 100,
    });
  });

  it.each([
    { subpath: "", outcome: "passed" },
    { subpath: "packages/app", outcome: "passed" },
    { subpath: "", outcome: "failed" },
    { subpath: "", outcome: "cancelled" },
    { subpath: "", outcome: "error" },
  ])(
    "preserves the chat checkout and cleans validation output ($outcome, app subpath: $subpath)",
    async ({ subpath, outcome }) => {
      const source = path.join(repo, subpath);
      await fs.mkdir(path.join(source, ".output"), { recursive: true });
      await fs.writeFile(
        path.join(source, ".output/bundle.js"),
        "committed output",
      );
      await fs.writeFile(
        path.join(source, "package.json"),
        JSON.stringify({ scripts: { build: "build-app" } }),
      );
      git(repo, "add", ".");
      git(repo, "commit", "-m", "initial");
      git(repo, "worktree", "add", "-b", "dyad/chat-1", workspace);
      const appPath = path.join(workspace, subpath);
      await fs.writeFile(path.join(appPath, "feature.ts"), "chat change");
      git(workspace, "add", ".");
      git(workspace, "commit", "-m", "chat checkpoint");
      const checkpoint = git(workspace, "rev-parse", "HEAD");
      const controller = new AbortController();
      let validationPath = "";
      vi.mocked(spawnStreaming).mockImplementation(async ({ cwd }) => {
        validationPath = cwd;
        expect(await fs.readFile(path.join(cwd, "feature.ts"), "utf8")).toBe(
          "chat change",
        );
        await fs.writeFile(
          path.join(cwd, ".output/bundle.js"),
          "rebuilt output",
        );
        await fs.writeFile(
          path.join(cwd, "generated.ts"),
          "generated during validation",
        );
        if (outcome === "error") throw new Error("build could not start");
        if (outcome === "cancelled") controller.abort();
        return {
          code: outcome === "failed" ? 1 : 0,
          stdout: "",
          stderr: "",
          aborted: outcome === "cancelled",
          timedOut: false,
        };
      });

      const validation = validateWorkspace({
        appPath,
        signal: controller.signal,
      });
      if (outcome === "error") {
        await expect(validation).rejects.toThrow("build could not start");
      } else {
        expect((await validation).passed).toBe(outcome === "passed");
      }
      expect(git(workspace, "status", "--porcelain")).toBe("");
      expect(git(workspace, "rev-parse", "HEAD")).toBe(checkpoint);
      expect(
        await fs.readFile(path.join(appPath, ".output/bundle.js"), "utf8"),
      ).toBe("committed output");
      expect(validationPath).not.toBe(appPath);
      await expect(fs.access(validationPath)).rejects.toThrow();
      expect(
        git(repo, "worktree", "list", "--porcelain").match(/^worktree /gm),
      ).toHaveLength(2);
    },
  );

  async function commitAndBranch(files: Record<string, string>) {
    for (const [file, content] of Object.entries(files)) {
      await fs.mkdir(path.dirname(path.join(repo, file)), { recursive: true });
      await fs.writeFile(path.join(repo, file), content);
    }
    git(repo, "add", ".");
    git(repo, "commit", "-m", "initial");
    git(repo, "worktree", "add", "-b", "dyad/chat-1", workspace);
  }

  function succeed() {
    vi.mocked(spawnStreaming).mockResolvedValue({
      code: 0,
      stdout: "",
      stderr: "",
      aborted: false,
      timedOut: false,
    });
  }

  it("installs a workspace member from its npm workspace root", async () => {
    await commitAndBranch({
      "package.json": JSON.stringify({ workspaces: ["packages/*"] }),
      "packages/app/package.json": JSON.stringify({
        name: "app",
        scripts: { build: "build-app" },
      }),
    });
    succeed();

    await validateWorkspace({ appPath: path.join(workspace, "packages/app") });

    const installCwd = vi.mocked(runCleanPackageInstall).mock.calls[0][0].cwd;
    const buildCwd = vi.mocked(spawnStreaming).mock.calls[0][0].cwd;
    expect(path.relative(installCwd, buildCwd)).toBe(
      path.join("packages", "app"),
    );
  });

  it.each([
    { script: "jest --watchAll", runs: false },
    { script: "jest --watch-all", runs: false },
    { script: "vitest --watch", runs: false },
    { script: "react-scripts test --watchAll=false", runs: true },
    // Browser runners need a running preview; the Tests panel runs them.
    { script: "playwright test", runs: false },
    { script: "vitest run && cypress run", runs: false },
  ])(
    "skips a test script that never finishes or needs a browser ($script)",
    async ({ script, runs }) => {
      await commitAndBranch({
        "package.json": JSON.stringify({ scripts: { test: script } }),
      });
      succeed();

      const { checks } = await validateWorkspace({ appPath: workspace });

      expect(checks.find((check) => check.name === "test")?.outcome).toBe(
        runs ? "passed" : "skipped",
      );
      const ranTestScript = vi
        .mocked(spawnStreaming)
        .mock.calls.some(([options]) => options.args?.includes("test"));
      expect(ranTestScript).toBe(runs);
    },
  );

  describe("type-check", () => {
    const problem = {
      file: "src/a.ts",
      line: 1,
      column: 1,
      code: 2322,
      message: "Type 'string' is not assignable to type 'number'.",
      snippet: "",
    };

    function typeCheck(checks: { name: string }[]) {
      return checks.find((check) => check.name === "type-check") as
        | { outcome: string; summary: string }
        | undefined;
    }

    it("type-checks a project that has only tsconfig.app.json", async () => {
      await commitAndBranch({
        "package.json": JSON.stringify({}),
        "tsconfig.app.json": "{}",
      });

      const { checks } = await validateWorkspace({
        appPath: workspace,
        baselineCommit: git(repo, "rev-parse", "HEAD"),
      });

      expect(runTypeScriptCheck).toHaveBeenCalledTimes(1);
      expect(runCleanPackageInstall).toHaveBeenCalledTimes(1);
      expect(typeCheck(checks)?.outcome).toBe("passed");
    });

    it("reports a missing TypeScript package as missing, not a transient failure", async () => {
      await commitAndBranch({
        "package.json": JSON.stringify({}),
        "tsconfig.json": "{}",
      });
      vi.mocked(runTypeScriptCheck).mockRejectedValueOnce(
        new TypeCheckPreconditionError(
          "typescript-not-found",
          "No local TypeScript CLI found",
        ),
      );

      const result = await validateWorkspace({ appPath: workspace });

      expect(typeCheck(result.checks)?.outcome).toBe("missing");
      // The same kind covers unreadable metadata or no `tsc` CLI, so the
      // summary does not claim TypeScript is absent.
      expect(typeCheck(result.checks)?.summary).toMatch(
        /No usable TypeScript CLI/,
      );
      expect(result.passed).toBe(true);
      expect(result.transientFailure).toBe(false);
    });

    it("keeps reporting other TypeScript errors as transient failures", async () => {
      await commitAndBranch({
        "package.json": JSON.stringify({}),
        "tsconfig.json": "{}",
      });
      vi.mocked(runTypeScriptCheck).mockRejectedValueOnce(
        new Error("utility process crashed"),
      );

      const result = await validateWorkspace({ appPath: workspace });

      expect(typeCheck(result.checks)?.outcome).toBe("failed");
      expect(result.passed).toBe(false);
      expect(result.transientFailure).toBe(true);
    });

    it("fails a second copy of a diagnostic the target already has once", async () => {
      await commitAndBranch({
        "package.json": JSON.stringify({}),
        "tsconfig.json": "{}",
      });
      vi.mocked(runTypeScriptCheck)
        .mockResolvedValueOnce({ problems: [problem, problem] })
        .mockResolvedValueOnce({ problems: [problem] });

      const { checks } = await validateWorkspace({
        appPath: workspace,
        baselineCommit: git(repo, "rev-parse", "HEAD"),
      });

      expect(typeCheck(checks)).toMatchObject({
        outcome: "failed",
        summary: "1 new TypeScript error.",
      });
    });

    it("checks an initialized submodule at the target's recorded commit", async () => {
      await commitAndBranch({
        "package.json": "{}",
        "tsconfig.json": "{}",
        "shared.ts": "original",
      });
      git(
        workspace,
        "-c",
        "protocol.file.allow=always",
        "submodule",
        "add",
        repo,
        "lib",
      );
      git(workspace, "commit", "-am", "Add library");
      const baselineCommit = git(workspace, "rev-parse", "HEAD");
      const library = path.join(workspace, "lib");
      await fs.writeFile(path.join(library, "shared.ts"), "updated");
      git(library, "commit", "-am", "Update library");
      git(workspace, "commit", "-am", "Use updated library");
      await fs.writeFile(path.join(library, "shared.ts"), "local edit");

      const checked: string[] = [];
      const check = async ({ appPath }: { appPath: string }) => {
        checked.push(
          await fs.readFile(path.join(appPath, "lib/shared.ts"), "utf8"),
        );
        return { problems: [problem] };
      };
      vi.mocked(runTypeScriptCheck)
        .mockImplementationOnce(check)
        .mockImplementationOnce(check);
      const result = await validateWorkspace({
        appPath: workspace,
        baselineCommit,
      });
      expect(result.passed).toBe(true);
      expect(checked).toEqual(["local edit", "original"]);
    });

    it("keeps the merge retryable if the baseline check could not run", async () => {
      await commitAndBranch({ "package.json": "{}", "tsconfig.json": "{}" });
      vi.mocked(runTypeScriptCheck)
        .mockResolvedValueOnce({ problems: [problem] })
        .mockRejectedValueOnce(new Error("TypeScript process timed out"));
      const result = await validateWorkspace({
        appPath: workspace,
        baselineCommit: git(repo, "rev-parse", "HEAD"),
      });
      expect(result).toMatchObject({ passed: false, transientFailure: true });
      expect(typeCheck(result.checks)?.summary).toContain(
        "TypeScript process timed out",
      );
    });

    it.each([
      { chatValue: "1", expected: "passed" },
      { chatValue: '"new error"', expected: "failed" },
    ])(
      "compares against the committed target with dirty main-folder edits ($expected)",
      async ({ chatValue, expected }) => {
        await commitAndBranch({
          "package.json": JSON.stringify({ workspaces: ["packages/*"] }),
          "packages/app/package.json": JSON.stringify({ name: "app" }),
          "packages/app/tsconfig.json": JSON.stringify({
            compilerOptions: { rootDir: "..", types: [] },
            include: ["*.ts", "../shared/*.ts"],
          }),
          "packages/shared/old.ts": 'export const x: number = "oops";\n',
          "README.md": "original\n",
        });
        const baselineCommit = git(repo, "rev-parse", "HEAD");
        await fs.appendFile(path.join(repo, "README.md"), "my edit\n");
        const appPath = path.join(workspace, "packages/app");
        const feature = `export const feature: number = ${chatValue};\n`;
        await fs.writeFile(path.join(appPath, "feature.ts"), feature);
        git(workspace, "add", ".");
        git(workspace, "commit", "-m", "chat change");
        // The same new error in a local-only file must never excuse the chat's.
        if (expected === "failed") {
          await fs.writeFile(
            path.join(repo, "packages/app/feature.ts"),
            feature,
          );
        }

        // Supply the installed compiler locally so both checkouts run a real
        // type-check without fetching packages.
        const installTypeScript = async ({ cwd }: { cwd: string }) => {
          const modules = path.join(cwd, "node_modules");
          await fs.mkdir(modules);
          await fs.symlink(
            path.dirname(require.resolve("typescript/package.json")),
            path.join(modules, "typescript"),
            "junction",
          );
          return {
            code: 0,
            aborted: false,
            timedOut: false,
            stdout: "",
            stderr: "",
            hasLockfile: false,
          };
        };
        vi.mocked(runCleanPackageInstall)
          .mockImplementationOnce(installTypeScript)
          .mockImplementationOnce(installTypeScript);
        const actual = await vi.importActual<
          typeof import("@/ipc/processors/tsc")
        >("@/ipc/processors/tsc");
        vi.mocked(runTypeScriptCheck)
          .mockImplementationOnce(actual.runTypeScriptCheck)
          .mockImplementationOnce(actual.runTypeScriptCheck);

        const result = await validateWorkspace({ appPath, baselineCommit });

        expect(typeCheck(result.checks)).toMatchObject({
          outcome: expected,
          summary:
            expected === "passed"
              ? "No new TypeScript errors (1 already existed on the target branch)."
              : "1 new TypeScript error.",
        });
        expect(result.passed).toBe(expected === "passed");
        expect(await fs.readFile(path.join(repo, "README.md"), "utf8")).toBe(
          "original\nmy edit\n",
        );
        expect(
          git(repo, "worktree", "list", "--porcelain").match(/^worktree /gm),
        ).toHaveLength(2);
      },
      30_000,
    );
  });
});
