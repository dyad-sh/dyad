import { spawnSync } from "node:child_process";

function run(cmd, args, opts = {}) {
  return spawnSync(cmd, args, {
    stdio: "pipe",
    encoding: "utf8",
    shell: process.platform === "win32",
    ...opts,
  });
}

function ok(result) {
  return result && typeof result.status === "number" && result.status === 0;
}

function printResult(label, result) {
  const out = (result.stdout || "").trim();
  const err = (result.stderr || "").trim();
  if (out) console.log(`[${label}] ${out}`);
  if (err) console.error(`[${label}] ${err}`);
}

// Keep local dev clean: only enforce global `cap` in CI (Ionic Appflow runs cap_sync outside npm scripts)
const isCI = String(process.env.CI || "").toLowerCase() === "true";
if (!isCI) {
  process.exit(0);
}

console.log("[ensure-capacitor-cli] CI detected; ensuring global `cap` is available...");

// 1) If cap is already available, we're done.
let res = run("cap", ["--version"]);
if (ok(res)) {
  printResult("cap", res);
  process.exit(0);
}

// 2) Try installing globally (works on Appflow; may fail locally but we only run in CI)
const desired = process.env.CAPACITOR_CLI_VERSION || "8.0.1";
console.log(`[ensure-capacitor-cli] Installing @capacitor/cli@${desired} globally...`);

res = run("npm", ["install", "-g", `@capacitor/cli@${desired}`], { stdio: "inherit" });
if (!ok(res)) {
  console.error("[ensure-capacitor-cli] Global install failed; cap_sync will likely fail in CI.");
  process.exit(res.status ?? 1);
}

// 3) Verify
const verify = run("cap", ["--version"]);
if (!ok(verify)) {
  printResult("cap", verify);
  console.error("[ensure-capacitor-cli] Installed globally but `cap` is still not resolvable on PATH.");
  process.exit(1);
}

printResult("cap", verify);
console.log("[ensure-capacitor-cli] OK");
