import fs from "node:fs/promises";
import { platform, tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { runBufferedProcess } from "./buffered_process";
import { execGit, getGitProcessEnvironment } from "./git_utils";

// Exercise Dyad's platform policy with the host's real Git executable.
// Changing process.platform would also change Dugite's executable resolution.
vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  const mockedOs = { ...actual, platform: vi.fn(actual.platform) };
  return { ...mockedOs, default: mockedOs };
});

describe.each(["execGit", "getGitProcessEnvironment"] as const)(
  "%s long-path support",
  (execution) => {
    let root: string;
    let repo: string;
    let globalConfigPath: string;
    let localConfigBefore: string;
    // Disable long paths in the local config below. Git for Windows can cache
    // a global core.longpaths=false while loading config, before applying the
    // per-process override, causing filesystem operations to ignore that override.
    const globalConfig = [
      "[user]",
      "name = Test User",
      "email = test@example.com",
      "[commit]",
      "gpgsign = false",
      "",
    ].join("\n");

    async function git(
      args: string[],
      callerEnv?: Record<string, string | undefined>,
    ): Promise<string> {
      if (execution === "execGit") {
        const result = await execGit(args, repo, { env: callerEnv });
        expect(result.exitCode, result.stderr).toBe(0);
        return result.stdout;
      }
      const { env, gitLocation } = getGitProcessEnvironment(callerEnv);
      const result = await runBufferedProcess({
        command: gitLocation,
        args,
        cwd: repo,
        env,
      });
      expect(result.code, result.stderr).toBe(0);
      return result.stdout;
    }

    beforeEach(async () => {
      vi.mocked(platform).mockReturnValue(process.platform);
      root = await fs.mkdtemp(path.join(tmpdir(), "dyad-git-paths-"));
      repo = path.join(root, "checkout");
      await fs.mkdir(repo);
      globalConfigPath = path.join(root, "gitconfig");
      await fs.writeFile(globalConfigPath, globalConfig);
      vi.stubEnv("GIT_CONFIG_GLOBAL", globalConfigPath);
      vi.stubEnv("GIT_CONFIG_NOSYSTEM", "1");
      vi.stubEnv("GIT_CONFIG_COUNT", undefined);
      vi.stubEnv("GIT_CONFIG_PARAMETERS", undefined);
      await git(["init", "-b", "main"]);
      // A local false overrides any bundled default, so Windows CI cannot
      // pass accidentally because the machine already enables long paths.
      await git(["config", "core.longpaths", "false"]);
      localConfigBefore = await fs.readFile(
        path.join(repo, ".git", "config"),
        "utf8",
      );
    });

    afterEach(async () => {
      vi.unstubAllEnvs();
      vi.mocked(platform).mockReset();
      await fs.rm(root, {
        recursive: true,
        force: true,
        maxRetries: 3,
        retryDelay: 100,
      });
    });

    it.each(["win32", "linux", "darwin"] as const)(
      "enables long paths only on Windows without persisting config (%s)",
      async (operatingSystem) => {
        vi.mocked(platform).mockReturnValue(operatingSystem);
        expect((await git(["config", "--get", "core.longpaths"])).trim()).toBe(
          operatingSystem === "win32" ? "true" : "false",
        );
        expect(
          await fs.readFile(path.join(repo, ".git", "config"), "utf8"),
        ).toBe(localConfigBefore);
        expect(await fs.readFile(globalConfigPath, "utf8")).toBe(globalConfig);
        expect(process.env.GIT_CONFIG_COUNT).toBeUndefined();
      },
    );

    it.each(["inherited", "caller"] as const)(
      "preserves %s authentication configuration when enabling long paths",
      async (configSource) => {
        vi.mocked(platform).mockReturnValue("win32");
        const configEnv = Object.freeze({
          GIT_CONFIG_COUNT: "3",
          GIT_CONFIG_KEY_0: "credential.helper",
          GIT_CONFIG_VALUE_0: "",
          GIT_CONFIG_KEY_1: "http.https://github.com/.extraheader",
          GIT_CONFIG_VALUE_1: "Authorization: Basic test-credential",
          GIT_CONFIG_KEY_2: "core.longpaths",
          GIT_CONFIG_VALUE_2: "false",
          GIT_TERMINAL_PROMPT: "0",
        });
        if (configSource === "inherited") {
          for (const [key, value] of Object.entries(configEnv)) {
            vi.stubEnv(key, value);
          }
        } else {
          // Caller config replaces the inherited count, so append after the
          // caller's entries rather than overwriting its authentication header.
          vi.stubEnv("GIT_CONFIG_COUNT", "1");
          vi.stubEnv("GIT_CONFIG_KEY_0", "test.inherited");
          vi.stubEnv("GIT_CONFIG_VALUE_0", "parent-process");
        }
        const callerEnv = configSource === "caller" ? configEnv : undefined;

        expect(
          (await git(["config", "--get", "core.longpaths"], callerEnv)).trim(),
        ).toBe("true");
        expect(
          (
            await git(
              ["config", "--get", "http.https://github.com/.extraheader"],
              callerEnv,
            )
          ).trim(),
        ).toBe(configEnv.GIT_CONFIG_VALUE_1);
        expect(
          (
            await git(["config", "--get", "credential.helper"], callerEnv)
          ).trim(),
        ).toBe("");
        expect(configEnv.GIT_CONFIG_COUNT).toBe("3");
        expect(process.env.GIT_CONFIG_COUNT).toBe(
          configSource === "inherited" ? "3" : "1",
        );
      },
    );

    it("stages, commits, inspects, and restores long paths in a regular checkout", async () => {
      expect((await git(["config", "--get", "core.longpaths"])).trim()).toBe(
        process.platform === "win32" ? "true" : "false",
      );
      const relativePath = [
        "nested-" + "a".repeat(75),
        "nested-" + "b".repeat(75),
        "migration-" + "c".repeat(75) + ".sql",
      ].join("/");
      const filePath = path.join(repo, relativePath);
      expect(filePath.length).toBeGreaterThan(260);
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, "select 1;\n");
      await git(["add", "--all"]);
      await git(["commit", "-m", "Track long path"]);
      await fs.writeFile(filePath, "select 2;\n");
      expect(await git(["status", "--porcelain=v1", "-z"])).toBe(
        ` M ${relativePath}\0`,
      );
      await fs.rm(filePath);
      await git(["checkout", "HEAD", "--", relativePath]);
      expect(await fs.readFile(filePath, "utf8")).toBe("select 1;\n");
      expect(await git(["status", "--porcelain=v1", "-z"])).toBe("");
      expect(await fs.readFile(path.join(repo, ".git", "config"), "utf8")).toBe(
        localConfigBefore,
      );
      expect(await fs.readFile(globalConfigPath, "utf8")).toBe(globalConfig);
    }, 30_000);
  },
);
