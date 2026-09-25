/**
 * Real-Docker canary for the isolated runtime. Opt in with
 * `DYAD_DOCKER_TESTS=1 npm test -- src/ipc/services/docker_runtime/docker_isolation.docker.test.ts`
 * against a running Docker daemon (Docker Desktop, OrbStack, Colima).
 * The first run builds the runtime image, which needs network access.
 *
 * A hostile app tries every escape it can from its install scripts; the test
 * asserts the host saw none of them.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "dyad-docker-ud-"));
vi.mock("@/paths/paths", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/paths/paths")>()),
  getUserDataPath: () => userDataDir,
}));
vi.mock("@/main/settings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/main/settings")>()),
  readSettings: () => ({ runtimeMode2: "docker" }),
}));

import { spawn } from "node:child_process";
import {
  appGuestInput,
  buildGuestInvocation,
  resolveGitMask,
  runGuestStreaming,
} from "./guest_command";
import { ensureRuntimeImage } from "./runtime_image";
import { runTypeScriptCheck } from "@/ipc/processors/tsc";
import { runDockerCli } from "./docker_cli";
import { getAppNodeModulesVolumeName } from "./names";

const enabled = process.env.DYAD_DOCKER_TESTS === "1";
// High enough never to collide with a real app's volume.
const APP_ID = 900_000 + Math.floor(Math.random() * 99_999);

describe.skipIf(!enabled)("Docker runtime isolation (real Docker)", () => {
  let root = "";
  let appPath = "";
  let hostMarker = "";
  let originalGitConfig = "";

  beforeAll(() => {
    root = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), "dyad-hostile-")),
    );
    appPath = path.join(root, "app");
    fs.mkdirSync(appPath);
    // Outside the app directory, so the guest has no mount that reaches it.
    hostMarker = path.join(root, "host-marker");

    execFileSync("git", ["init", "-q"], { cwd: appPath });
    originalGitConfig = fs.readFileSync(
      path.join(appPath, ".git", "config"),
      "utf8",
    );

    const escape = [
      // 1. Write a file at a host path outside the mount.
      `touch ${hostMarker} 2>/dev/null || true`,
      // 2. Poison repository config so host git runs a command.
      `mkdir -p .git && printf '[core]\\n\\tfsmonitor = touch ${hostMarker}\\n' >> .git/config 2>/dev/null || true`,
      // 3. Plant a hook for the host's next commit.
      `mkdir -p .git/hooks && printf '#!/bin/sh\\ntouch ${hostMarker}\\n' > .git/hooks/pre-commit 2>/dev/null || true`,
      // 4. Leave an executable in node_modules for the host to pick up later.
      `mkdir -p node_modules/.bin && printf '#!/bin/sh\\ntouch ${hostMarker}\\n' > node_modules/.bin/tsc`,
      // 5. Try to read a host secret from the environment.
      `echo "env-secret=$DYAD_CANARY_HOST_SECRET" > leaked-env.txt`,
      // Evidence that the script really ran, written where the host can read it.
      `echo ran > ran-in-guest.txt`,
    ].join(" && ");

    fs.writeFileSync(
      path.join(appPath, "package.json"),
      JSON.stringify(
        {
          name: "hostile",
          version: "1.0.0",
          private: true,
          scripts: { postinstall: escape },
        },
        null,
        2,
      ),
    );
  });

  afterAll(async () => {
    await runDockerCli([
      "volume",
      "rm",
      "-f",
      getAppNodeModulesVolumeName(APP_ID),
    ]);
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(userDataDir, { recursive: true, force: true });
  });

  it(
    "runs the app's install scripts in the guest and nowhere else",
    async () => {
      process.env.DYAD_CANARY_HOST_SECRET = "must-not-leak";
      let output = "";
      const result = await runGuestStreaming(
        await appGuestInput({
          appId: APP_ID,
          appPath,
          command: "pnpm",
          args: ["install", "--config.strictDepBuilds=false"],
        }),
        { timeoutMs: 10 * 60_000, onOutput: (chunk) => (output += chunk) },
      );
      expect(result.code, output).toBe(0);

      // The script ran, inside the guest.
      expect(
        fs.readFileSync(path.join(appPath, "ran-in-guest.txt"), "utf8"),
      ).toBe("ran\n");
      // 1. No write outside the mount.
      expect(fs.existsSync(hostMarker)).toBe(false);
      // 2 + 3. The host repository is untouched (the guest wrote to a tmpfs).
      expect(
        fs.readFileSync(path.join(appPath, ".git", "config"), "utf8"),
      ).toBe(originalGitConfig);
      expect(
        fs.existsSync(path.join(appPath, ".git", "hooks", "pre-commit")),
      ).toBe(false);
      // 4. node_modules lives in the volume. Docker leaves an empty mount-point
      // directory on the host, but none of the guest's files.
      expect(fs.readdirSync(path.join(appPath, "node_modules"))).toEqual([]);
      // 5. The host environment was not forwarded.
      expect(
        fs.readFileSync(path.join(appPath, "leaked-env.txt"), "utf8"),
      ).toBe("env-secret=\n");

      // Host git status (which would run a poisoned fsmonitor) stays clean.
      execFileSync("git", ["status", "--porcelain"], { cwd: appPath });
      expect(fs.existsSync(hostMarker)).toBe(false);
    },
    15 * 60_000,
  );

  it("keeps dependencies in the app's volume across runs", async () => {
    const result = await runGuestStreaming(
      await appGuestInput({
        appId: APP_ID,
        appPath,
        command: "sh",
        args: ["-c", "test -f node_modules/.bin/tsc"],
      }),
      { timeoutMs: 60_000 },
    );
    expect(result.code).toBe(0);
  }, 120_000);

  it("removes the container when the run is cancelled", async () => {
    const controller = new AbortController();
    const run = runGuestStreaming(
      await appGuestInput({
        appId: APP_ID,
        appPath,
        command: "sleep",
        args: ["300"],
      }),
      { signal: controller.signal, timeoutMs: 120_000 },
    );
    await new Promise((resolve) => setTimeout(resolve, 3_000));
    controller.abort();
    const result = await run;
    expect(result.aborted).toBe(true);

    const remaining = await runDockerCli([
      "ps",
      "-aq",
      "--filter",
      `label=dyad.app-id=${APP_ID}`,
    ]);
    expect(remaining.stdout.trim()).toBe("");
  }, 120_000);

  it(
    "serves the scaffold dev server from the container through the published port",
    async () => {
      const scaffoldPath = path.join(root, "scaffold");
      fs.cpSync(path.resolve(__dirname, "../../../../scaffold"), scaffoldPath, {
        recursive: true,
        filter: (source) => !source.includes("node_modules"),
      });
      const port = 45_000 + Math.floor(Math.random() * 1_000);
      // A separate app ID: the hostile app above planted files in its volume.
      const scaffoldAppId = APP_ID + 1;
      const containerName = `dyad-app-${scaffoldAppId}`;
      const imageTag = await ensureRuntimeImage("base");
      // Same shape executeAppInDocker uses for the preview.
      const invocation = buildGuestInvocation(
        {
          appId: scaffoldAppId,
          hostRoot: scaffoldPath,
          cwd: scaffoldPath,
          command: "sh",
          args: [
            "-c",
            `pnpm install && pnpm exec vite --port ${port} --host 0.0.0.0`,
          ],
          env: { pnpm_config_strict_dep_builds: "false" },
          nodeModules: "app-volume",
          image: "base",
          gitMask: await resolveGitMask(scaffoldPath),
          publishPorts: [port],
          containerName,
          role: "app",
        },
        imageTag,
      );
      const child = spawn(invocation.command, invocation.args, {
        env: invocation.clientEnv,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let log = "";
      child.stdout.on("data", (chunk) => (log += chunk));
      child.stderr.on("data", (chunk) => (log += chunk));
      try {
        const deadline = Date.now() + 5 * 60_000;
        let body = "";
        while (Date.now() < deadline) {
          try {
            const response = await fetch(`http://localhost:${port}/`);
            if (response.ok) {
              body = await response.text();
              break;
            }
          } catch {
            // Not listening yet.
          }
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
        expect(body, log.slice(-3000)).toContain('<div id="root">');
        expect(fs.readdirSync(path.join(scaffoldPath, "node_modules"))).toEqual(
          [],
        );

        // Type checking runs the app's own TypeScript, so it must run in the
        // guest against the volume; the host has no node_modules to use.
        fs.writeFileSync(
          path.join(scaffoldPath, "src", "broken.ts"),
          'export const n: number = "not a number";\n',
        );
        const report = await runTypeScriptCheck({
          appId: scaffoldAppId,
          appPath: scaffoldPath,
        });
        expect(report.outcome).toBe("errors");
        expect(report.problems).toEqual([
          expect.objectContaining({ file: "src/broken.ts", line: 1 }),
        ]);
        fs.rmSync(path.join(scaffoldPath, "src", "broken.ts"));

        // Playwright runs in the browser image, joined to the dev server's
        // network so the preview is reachable at its own localhost origin.
        fs.writeFileSync(
          path.join(scaffoldPath, "smoke.spec.ts"),
          `import { test, expect } from "@playwright/test";
test("renders", async ({ page }) => {
  await page.goto("http://localhost:${port}/");
  await expect(page.locator("h1")).toBeVisible();
});
`,
        );
        const playwright = async (args: string[]) => {
          let out = "";
          const result = await runGuestStreaming(
            await appGuestInput({
              appId: scaffoldAppId,
              appPath: scaffoldPath,
              command: "sh",
              args: ["-c", args.join(" ")],
              image: "playwright",
              joinNetworkOf: containerName,
            }),
            { timeoutMs: 15 * 60_000, onOutput: (chunk) => (out += chunk) },
          );
          return { code: result.code, out };
        };
        const install = await playwright([
          "pnpm add -D --config.strictDepBuilds=false @playwright/test@1.58.2",
          "&& node node_modules/@playwright/test/cli.js install chromium",
        ]);
        expect(install.code, install.out.slice(-3000)).toBe(0);
        const run = await playwright([
          "node node_modules/@playwright/test/cli.js test smoke.spec.ts --reporter=line",
        ]);
        expect(run.code, run.out.slice(-3000)).toBe(0);
      } finally {
        child.kill();
        await runDockerCli(["rm", "-f", containerName]);
        await runDockerCli([
          "volume",
          "rm",
          "-f",
          getAppNodeModulesVolumeName(scaffoldAppId),
        ]);
      }
    },
    10 * 60_000,
  );
});
