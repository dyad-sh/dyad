// Run in the installed (unfused) Electron runtime, loading native dependencies
// from the packaged ASAR. The shipped executable disables RunAsNode.
const { app } = require("electron");
const assert = require("node:assert/strict");
const { createRequire } = require("node:module");
const path = require("node:path");

globalThis.packagedNativeProbe = app.whenReady().then(async () => {
  const archive = path.join(process.argv[2], "app.asar");
  const packagedRequire = createRequire(path.join(archive, "package.json"));
  const load = (name) => {
    assert.ok(packagedRequire.resolve(name).startsWith(archive + path.sep));
    return packagedRequire(name);
  };

  const Database = load("better-sqlite3");
  const database = new Database(":memory:");
  try {
    assert.equal(database.prepare("SELECT 45 AS value").get().value, 45);
  } finally {
    database.close();
  }

  const { Mustard } = load("mustardscript");
  assert.equal(
    await new Mustard("return 6 * 7;", { lenientMode: true }).run(),
    42,
  );

  const pty = load("node-pty");
  await new Promise((resolve, reject) => {
    let output = "";
    const terminal = pty.spawn(
      process.platform === "win32"
        ? process.env.ComSpec || "cmd.exe"
        : "/bin/sh",
      process.platform === "win32"
        ? ["/d", "/s", "/c", "echo DYAD_PTY_OK"]
        : ["-c", "echo DYAD_PTY_OK"],
      { cwd: app.getPath("temp"), env: process.env },
    );
    const timer = setTimeout(() => {
      terminal.kill();
      reject(new Error("Packaged PTY did not exit within 15 seconds"));
    }, 15_000);
    terminal.onData((data) => {
      output += data;
    });
    terminal.onExit(({ exitCode }) => {
      clearTimeout(timer);
      try {
        assert.equal(exitCode, 0);
        assert.match(output, /DYAD_PTY_OK/);
        resolve();
      } catch (error) {
        reject(error);
      }
    });
  });

  if (process.platform === "darwin") {
    // Binding load only. Never read or change the host's Keychain here.
    const reader = load("dyad-keychain-reader");
    assert.equal(typeof reader.readGenericPassword, "function");
    assert.equal(typeof reader.isDefaultKeychainLocked, "function");
  }
  return { electron: process.versions.electron, arch: process.arch };
});
// Avoid an unhandled rejection before Playwright attaches and awaits the probe.
globalThis.packagedNativeProbe.catch(() => {});
