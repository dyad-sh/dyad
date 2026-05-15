const childProcess = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const buildId = process.argv[2];

if (!buildId) {
  console.error("Usage: node build-once.cjs <build-id>");
  process.exit(1);
}

const distDir = path.join(__dirname, "dist");
const lockPath = path.join(distDir, `.build-${buildId}.lock`);
const markerPath = path.join(distDir, `.build-${buildId}.done`);
const timeoutMs = 120_000;
const pollMs = 250;

fs.mkdirSync(distDir, { recursive: true });

function runBuild() {
  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
  const result = childProcess.spawnSync(npmCommand, ["run", "build"], {
    cwd: __dirname,
    stdio: "inherit",
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(
      `Fake LLM server build failed with exit code ${result.status}`,
    );
  }
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

try {
  const lockFd = fs.openSync(lockPath, "wx");

  try {
    runBuild();
    fs.writeFileSync(markerPath, String(Date.now()));
  } finally {
    fs.closeSync(lockFd);
    fs.rmSync(lockPath, { force: true });
  }
} catch (error) {
  if (error.code !== "EEXIST") {
    console.error(error);
    process.exit(1);
  }

  const startedAt = Date.now();
  while (!fs.existsSync(markerPath)) {
    if (Date.now() - startedAt > timeoutMs) {
      console.error("Timed out waiting for fake LLM server build to complete");
      process.exit(1);
    }
    sleep(pollMs);
  }
}
