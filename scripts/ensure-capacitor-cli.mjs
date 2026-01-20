import { spawnSync, execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

function run(cmd, args, opts = {}) {
  return spawnSync(cmd, args, {
    stdio: "pipe",
    encoding: "utf8",
    shell: true,
    ...opts,
  });
}

function ok(result) {
  return result && typeof result.status === "number" && result.status === 0;
}

// Keep local dev clean: only enforce global `cap` in CI
const isCI = process.env.CI === "true" || process.env.IONIC_TOKEN || process.env.APPFLOW_BUILD;
if (!isCI) {
  console.log("[ensure-capacitor-cli] Not in CI, skipping global install");
  process.exit(0);
}

console.log("[ensure-capacitor-cli] CI detected; ensuring `cap` is available...");

// 1) Check if cap is already available
let res = run("cap", ["--version"]);
if (ok(res)) {
  console.log(`[ensure-capacitor-cli] cap already available: ${(res.stdout || "").trim()}`);
  process.exit(0);
}

// 2) Check if npx cap works
res = run("npx", ["cap", "--version"]);
if (ok(res)) {
  console.log(`[ensure-capacitor-cli] npx cap available: ${(res.stdout || "").trim()}`);
  
  // Create a symlink/wrapper so 'cap' works directly
  try {
    const npmPrefix = execSync("npm config get prefix", { encoding: "utf8" }).trim();
    const binDir = join(npmPrefix, "bin");
    console.log(`[ensure-capacitor-cli] Creating cap wrapper in ${binDir}`);
    
    // On macOS/Linux, create a shell script wrapper
    execSync(`mkdir -p "${binDir}" && echo '#!/bin/sh\\nexec npx cap "$@"' > "${binDir}/cap" && chmod +x "${binDir}/cap"`, { stdio: "inherit" });
    
    console.log("[ensure-capacitor-cli] Wrapper created successfully");
  } catch (e) {
    console.log(`[ensure-capacitor-cli] Could not create wrapper: ${e.message}`);
  }
  process.exit(0);
}

// 3) Try installing globally
const desired = process.env.CAPACITOR_CLI_VERSION || "8.0.1";
console.log(`[ensure-capacitor-cli] Installing @capacitor/cli@${desired} globally...`);

res = run("npm", ["install", "-g", `@capacitor/cli@${desired}`], { stdio: "inherit" });
if (!ok(res)) {
  console.error("[ensure-capacitor-cli] Global install failed");
  // Don't fail the build - let cap_sync try with npx
  process.exit(0);
}

// 4) Verify
res = run("cap", ["--version"]);
console.log(`[ensure-capacitor-cli] Verification: ${ok(res) ? (res.stdout || "").trim() : "failed"}`);
process.exit(0);
