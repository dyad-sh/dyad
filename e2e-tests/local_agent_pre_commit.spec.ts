import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { expect } from "@playwright/test";
import {
  testSkipIfWindows,
  Timeout,
  type PageObject,
} from "./helpers/test_helper";

const TEST_FILE = "src/pre-commit-e2e.txt";

function git(cwd: string, ...args: string[]) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function installPreCommitHook(
  appPath: string,
  mode: "fix-then-pass" | "always-fail",
) {
  const hookPath = git(
    appPath,
    "rev-parse",
    "--path-format=absolute",
    "--git-path",
    "hooks/pre-commit",
  );
  const gitDir = git(appPath, "rev-parse", "--absolute-git-dir");
  const runLogPath = path.join(gitDir, "pre-commit-e2e-runs");
  const testFilePath = path.join(appPath, TEST_FILE);
  const behavior =
    mode === "fix-then-pass"
      ? [
          'const content = fs.readFileSync(testFilePath, "utf8").trim();',
          'if (content === "needs formatting") {',
          '  fs.writeFileSync(testFilePath, "formatted by pre-commit\\n");',
          '  console.error("pre-commit fixed formatting; rerun required");',
          "  process.exit(1);",
          "}",
          'if (content !== "formatted by pre-commit") {',
          '  console.error("unexpected file content");',
          "  process.exit(1);",
          "}",
          'console.log("pre-commit passed");',
        ].join("\n")
      : [
          'console.error("pre-commit intentionally rejects this commit");',
          "process.exit(1);",
        ].join("\n");

  fs.mkdirSync(path.dirname(hookPath), { recursive: true });
  fs.writeFileSync(
    hookPath,
    [
      "#!/usr/bin/env node",
      'import fs from "node:fs";',
      "const runLogPath = " + JSON.stringify(runLogPath) + ";",
      "const testFilePath = " + JSON.stringify(testFilePath) + ";",
      'fs.appendFileSync(runLogPath, "run\\n");',
      behavior,
      "",
    ].join("\n"),
  );
  if (process.platform !== "win32") {
    fs.chmodSync(hookPath, 0o755);
  }

  return runLogPath;
}

async function setUpAppWithHook(
  po: PageObject,
  mode: "fix-then-pass" | "always-fail",
) {
  await po.setUpDyadPro({ localAgent: true, autoApprove: true });
  await po.importApp("minimal");
  await po.chatActions.selectLocalAgentMode();
  await po.appManagement.configureGitUser();

  const appPath = await po.appManagement.getCurrentAppPath();
  const runLogPath = installPreCommitHook(appPath, mode);
  return { appPath, runLogPath, headBefore: git(appPath, "rev-parse", "HEAD") };
}

testSkipIfWindows(
  "local-agent - pre-commit hook fixes files and passes when rerun",
  async ({ po }) => {
    const { appPath, runLogPath, headBefore } = await setUpAppWithHook(
      po,
      "fix-then-pass",
    );

    await po.sendPrompt("tc=local-agent/pre-commit-fixes", {
      skipWaitForCompletion: true,
    });
    await po.chatActions.waitForChatCompletion({ timeout: Timeout.LONG });

    await expect(
      po.page.getByRole("button", { name: /Pre-commit failed/ }),
    ).toBeVisible();
    await expect(
      po.page.getByRole("button", { name: /Pre-commit passed/ }),
    ).toBeVisible();
    expect(fs.readFileSync(runLogPath, "utf8")).toBe("run\nrun\n");
    expect(fs.readFileSync(path.join(appPath, TEST_FILE), "utf8")).toBe(
      "formatted by pre-commit\n",
    );
    expect(git(appPath, "rev-parse", "HEAD")).not.toBe(headBefore);
    expect(git(appPath, "show", "HEAD:" + TEST_FILE)).toBe(
      "formatted by pre-commit",
    );
  },
);

testSkipIfWindows(
  "local-agent - no-verify commits files when pre-commit keeps failing",
  async ({ po }) => {
    const { appPath, runLogPath, headBefore } = await setUpAppWithHook(
      po,
      "always-fail",
    );

    await po.sendPrompt("tc=local-agent/pre-commit-no-verify", {
      skipWaitForCompletion: true,
    });
    await po.chatActions.waitForChatCompletion({ timeout: Timeout.LONG });

    await expect(
      po.page.getByRole("button", { name: /Pre-commit failed/ }),
    ).toBeVisible();
    expect(fs.readFileSync(runLogPath, "utf8")).toBe("run\n");
    expect(git(appPath, "rev-parse", "HEAD")).not.toBe(headBefore);
    expect(git(appPath, "show", "HEAD:" + TEST_FILE)).toBe(
      "commit despite hook failure",
    );
  },
);
