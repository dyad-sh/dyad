const assert = require("node:assert/strict");
const { spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { once } = require("node:events");
const { test } = require("node:test");
const { createWindowsInstaller } = require("electron-winstaller");
const { squirrelVendorDirectory } = require("./prepare-vendor.cjs");

const probe = path.resolve(
  __dirname,
  "../../.cache/squirrel-tests/guard-probe.exe",
);

async function startWaiting(executable, args, t) {
  const child = spawn(executable, args, { windowsHide: true });
  const exited = once(child, "exit");
  t.after(async () => {
    if (child.exitCode === null) child.kill();
    await exited;
  });
  await Promise.race([
    (async () => {
      let output = "";
      for await (const chunk of child.stdout) {
        output += chunk;
        if (output.includes("READY")) return;
      }
      throw new Error("Guard fixture exited before becoming ready");
    })(),
    exited.then(([code]) => {
      throw new Error(`Guard fixture exited: ${code}`);
    }),
  ]);
  return child;
}

function run(executable, args) {
  const result = spawnSync(executable, args, {
    windowsHide: true,
    timeout: 30_000,
    encoding: "utf8",
  });
  if (result.error) throw result.error;
  return result.status;
}

test(
  "Windows installer preflight",
  { skip: process.platform !== "win32", timeout: 180_000 },
  async (t) => {
    const temporary = await fs.mkdtemp(
      path.join(os.tmpdir(), "dyad-setup-test-"),
    );
    t.after(() => fs.rm(temporary, { recursive: true, force: true }));
    const root = path.join(temporary, "dyad");
    const sibling = root + "-other";
    await fs.mkdir(root);
    await fs.mkdir(sibling);

    await t.test(
      "matches case-insensitively without matching sibling prefixes",
      () => {
        assert.equal(
          run(probe, [
            "--inside",
            root.toUpperCase() + "\\app\\tool.exe",
            root,
          ]),
          0,
        );
        assert.equal(run(probe, ["--inside", sibling + "\\dyad.exe", root]), 1);
        assert.equal(run(probe, ["--acquire", root]), 0);
      },
    );

    await t.test(
      "refuses a child executable under the installation and allows another installation",
      async (t) => {
        const installedChild = path.join(root, "child tool.exe");
        await fs.copyFile(probe, installedChild);
        await startWaiting(installedChild, ["--wait"], t);
        assert.equal(run(probe, ["--acquire", root]), 170); // ERROR_BUSY
        assert.equal(run(probe, ["--acquire", sibling]), 0);
      },
    );

    await t.test(
      "serializes installers and releases the mutex after exit",
      async (t) => {
        const holder = await startWaiting(
          probe,
          ["--acquire", root, "--hold"],
          t,
        );
        assert.equal(run(probe, ["--acquire", root]), 1618);
        const exited = once(holder, "exit");
        holder.kill();
        await exited;
        assert.equal(run(probe, ["--acquire", root]), 0);
      },
    );

    // Exercise the real, generated Setup executable, not just the helper. This
    // fixture is intentionally confined to a clean CI Windows user profile.
    await t.test(
      "generated Setup refuses both cases before touching installed files",
      async (t) => {
        const appDirectory = path.join(temporary, "app");
        const outputDirectory = path.join(temporary, "installer");
        await fs.mkdir(appDirectory);
        await fs.copyFile(probe, path.join(appDirectory, "dyad.exe"));
        await createWindowsInstaller({
          appDirectory,
          outputDirectory,
          vendorDirectory: squirrelVendorDirectory,
          name: "dyad",
          title: "Dyad guard test",
          version: "0.0.1",
          authors: "Dyad",
          description: "Disposable installer regression fixture",
          exe: "dyad.exe",
          setupExe: "Setup.exe",
          noMsi: true,
          noDelta: true,
          usePackageJson: false,
        });
        const setup = path.join(outputDirectory, "Setup.exe");
        const installRoot = path.join(process.env.LOCALAPPDATA, "dyad");
        // Never overwrite or delete a developer's real installation.
        try {
          await fs.lstat(installRoot);
          throw new Error(
            "Run installer integration tests in a clean Windows user profile without Dyad installed",
          );
        } catch (error) {
          if (error.code !== "ENOENT") throw error;
        }
        await fs.mkdir(installRoot);
        t.after(() => fs.rm(installRoot, { recursive: true, force: true }));
        const installedExe = path.join(installRoot, "dyad.exe");
        await fs.copyFile(probe, installedExe);
        const sentinel = path.join(installRoot, "preserve-me.txt");
        await fs.writeFile(sentinel, "existing installation");
        const runningApp = await startWaiting(installedExe, ["--wait"], t);
        assert.equal(run(setup, ["--silent"]), 170);
        assert.equal(
          await fs.readFile(sentinel, "utf8"),
          "existing installation",
        );
        assert.deepEqual(
          await fs.readFile(installedExe),
          await fs.readFile(probe),
        );
        const exited = once(runningApp, "exit");
        runningApp.kill();
        await exited;

        await t.test("a second Setup cannot reach extraction", async (t) => {
          await startWaiting(probe, ["--acquire", installRoot, "--hold"], t);
          assert.equal(run(setup, ["--silent"]), 1618);
          assert.equal(
            await fs.readFile(sentinel, "utf8"),
            "existing installation",
          );
        });

        assert.equal(run(setup, ["--silent"]), 0);
        await fs.access(path.join(installRoot, "app-0.0.1", "dyad.exe"));
        await fs.access(path.join(installRoot, "Update.exe"));
      },
    );
  },
);
