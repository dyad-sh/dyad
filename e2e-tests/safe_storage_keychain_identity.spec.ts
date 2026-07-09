/**
 * Reproduces https://github.com/dyad-sh/dyad/issues/3837: secrets encrypted
 * with Electron safeStorage on macOS become unreadable after upgrading from
 * Electron 40 to Electron 43.
 *
 * Root cause (verified empirically):
 * - `registerAppHandlers()` fires `reconcileCloudSandboxes()` at module scope
 *   (src/ipc/handlers/app_handlers.ts), which calls `readSettings()` BEFORE
 *   `app.whenReady()`. When the settings file contains an
 *   `electron-safe-storage` secret, decrypting it touches safeStorage
 *   pre-ready.
 * - On Electron 40, a pre-ready safeStorage call silently initializes the
 *   macOS Keychain entry under the default "Chromium Safe Storage" identity
 *   instead of "dyad Safe Storage", and that (wrong) key is cached for the
 *   rest of the process.
 * - On Electron 43, safeStorage refuses to run pre-ready ("safeStorage cannot
 *   be used before app is ready") and post-ready always uses the proper
 *   "dyad Safe Storage" identity — so ciphertext produced under the Chromium
 *   identity can never be decrypted again after the upgrade.
 *
 * Both tests below are CHARACTERIZATION tests: they assert today's broken
 * behavior so the repro is executable. If the pre-ready race is fixed (or a
 * Keychain migration ships), they will start failing — flip the assertions
 * into a regression test at that point.
 *
 * These tests are opt-in because they must swap the user's DEFAULT macOS
 * keychain to a temporary one for the duration of the run (safeStorage always
 * uses the default keychain; using the real login keychain would pollute it
 * with "Chromium Safe Storage"/"dyad Safe Storage" entries shared with real
 * apps). If the run is killed hard mid-test, restore manually with:
 *
 *   security default-keychain -s ~/Library/Keychains/login.keychain-db
 *   security list-keychains -d user -s ~/Library/Keychains/login.keychain-db
 *
 * Usage (test 1 needs only the normal e2e build in out/):
 *
 *   npm run pre:e2e
 *   DYAD_E2E_SAFE_STORAGE=1 npx playwright test \
 *     e2e-tests/safe_storage_keychain_identity.spec.ts --workers=1
 *
 * For the upgrade test, additionally build the app at the Electron 43 commit
 * (the parent of the revert d24360e89ba54cd8386d5148a74437df10ced414, e.g. in
 * a worktree: `git checkout d24360e8~1 && npm ci && npm run pre:e2e`) and
 * point at its packaged output:
 *
 *   DYAD_E2E_SAFE_STORAGE=1 \
 *   DYAD_E2E_SAFE_STORAGE_UPGRADE_BUILD=/path/to/e43/out/dyad-darwin-arm64 \
 *   npx playwright test e2e-tests/safe_storage_keychain_identity.spec.ts --workers=1
 */

import { expect, test } from "@playwright/test";
import { execFileSync } from "child_process";
import * as eph from "electron-playwright-helpers";
import fs from "fs";
import os from "os";
import path from "path";
import { ElectronApplication, _electron as electron } from "playwright";

const ENABLED =
  process.platform === "darwin" && process.env.DYAD_E2E_SAFE_STORAGE === "1";

const UPGRADE_BUILD_DIR = process.env.DYAD_E2E_SAFE_STORAGE_UPGRADE_BUILD;

// Keychain service names created by Chromium's os_crypt on macOS. The service
// is "<product name> Safe Storage"; pre-ready initialization on Electron 40
// runs before the app name is applied, so it falls back to "Chromium".
const DYAD_SERVICE = "dyad Safe Storage";
const CHROMIUM_SERVICE = "Chromium Safe Storage";

const KEYCHAIN_PASSWORD = "dyad-e2e-safe-storage";
const TEMP_KEYCHAIN = path.join(
  os.tmpdir(),
  `dyad-e2e-safe-storage-${process.pid}.keychain-db`,
);

let originalDefaultKeychain: string | null = null;
let originalSearchList: string[] = [];

function security(args: string[]): string {
  return execFileSync("security", args, { encoding: "utf8" });
}

// Output lines look like:  "    "/Users/me/Library/Keychains/login.keychain-db""
function parseKeychainPaths(output: string): string[] {
  return output
    .split("\n")
    .map((line) => line.trim().replace(/^"|"$/g, ""))
    .filter(Boolean);
}

// Recreates the temporary keychain from scratch and makes it the default.
// Items created by a previous test would otherwise leak the derived key into
// the next test (safeStorage reuses an existing "... Safe Storage" entry).
function freshTempKeychain(): void {
  try {
    security(["delete-keychain", TEMP_KEYCHAIN]);
  } catch {
    // Not created yet.
  }
  security(["create-keychain", "-p", KEYCHAIN_PASSWORD, TEMP_KEYCHAIN]);
  security(["unlock-keychain", "-p", KEYCHAIN_PASSWORD, TEMP_KEYCHAIN]);
  // Disable auto-lock so long launches can't hit a re-locked keychain.
  security(["set-keychain-settings", TEMP_KEYCHAIN]);
  security(["default-keychain", "-s", TEMP_KEYCHAIN]);
  // SecItemCopyMatching searches the search list, not the default keychain,
  // so the temp keychain must be in it for lookups to find created items.
  security(["list-keychains", "-d", "user", "-s", TEMP_KEYCHAIN]);

  // Pre-seed the Safe Storage items for both identities with the "allow all
  // apps" ACL (-A) and fixed passwords. Chromium then reads these instead of
  // creating its own ACL-restricted items — which an unsigned e2e build could
  // not re-read in a second process without an interactive Keychain prompt.
  // (A prod build is Developer ID-signed, so re-reading its own items works
  // there; this only levels the test environment, it does not change which
  // identity a session uses.) Because the passwords are constants, the
  // derived encryption keys survive keychain re-creation, so tests call this
  // before EVERY app launch: each session then gets first-touch access,
  // sidestepping macOS partition-list restrictions on items previously
  // accessed by an unsigned binary.
  for (const [service, account, password] of [
    [CHROMIUM_SERVICE, "Chromium", "e2e-chromium-identity-key"],
    [DYAD_SERVICE, "dyad", "e2e-dyad-identity-key"],
  ]) {
    security([
      "add-generic-password",
      "-A",
      "-s",
      service,
      "-a",
      account,
      "-w",
      password,
      TEMP_KEYCHAIN,
    ]);
  }
}

function restoreOriginalKeychains(): void {
  if (originalDefaultKeychain) {
    security(["default-keychain", "-s", originalDefaultKeychain]);
  }
  if (originalSearchList.length > 0) {
    security(["list-keychains", "-d", "user", "-s", ...originalSearchList]);
  }
  try {
    security(["delete-keychain", TEMP_KEYCHAIN]);
  } catch {
    // Already gone.
  }
}

async function launchDyad({
  userDataDir,
  buildDir,
}: {
  userDataDir: string;
  buildDir?: string;
}): Promise<ElectronApplication> {
  const appInfo = eph.parseElectronApp(buildDir ?? eph.findLatestBuild());
  const electronApp = await electron.launch({
    args: [appInfo.main, "--enable-logging", `--user-data-dir=${userDataDir}`],
    executablePath: appInfo.executable,
    env: {
      ...process.env,
      E2E_TEST_BUILD: "true",
      // Skips the AI setup screen (same hack as the shared fixture).
      OPENAI_API_KEY: "sk-test",
    },
  });
  // Ensures the app is fully ready before main-process evaluate calls.
  await electronApp.firstWindow();
  return electronApp;
}

async function closeDyad(electronApp: ElectronApplication): Promise<void> {
  const child = electronApp.process();
  await Promise.race([
    electronApp.close(),
    new Promise<void>((resolve) => setTimeout(resolve, 15_000)),
  ]);
  if (child.pid && child.exitCode === null && !child.signalCode) {
    child.kill("SIGKILL");
  }
}

function encryptViaApp(
  electronApp: ElectronApplication,
  plaintext: string,
): Promise<string> {
  return electronApp.evaluate(({ safeStorage }, text) => {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error("safeStorage encryption is not available");
    }
    return safeStorage.encryptString(text).toString("base64");
  }, plaintext);
}

// Returns the decrypted plaintext, or the thrown error message prefixed with
// "ERROR: " so tests can assert on failure modes without try/catch plumbing
// across the evaluate boundary.
function decryptViaApp(
  electronApp: ElectronApplication,
  ciphertextBase64: string,
): Promise<string> {
  return electronApp.evaluate(({ safeStorage }, ciphertext) => {
    try {
      return safeStorage.decryptString(Buffer.from(ciphertext, "base64"));
    } catch (error) {
      return `ERROR: ${error instanceof Error ? error.message : String(error)}`;
    }
  }, ciphertextBase64);
}

async function readSettingsViaIpc(
  electronApp: ElectronApplication,
): Promise<any> {
  const page = await electronApp.firstWindow();
  return page.evaluate(() =>
    (window as any).electron.ipcRenderer.invoke("get-user-settings"),
  );
}

function settingsPath(userDataDir: string): string {
  return path.join(userDataDir, "user-settings.json");
}

function writeGithubTokenCiphertext(
  userDataDir: string,
  ciphertextBase64: string,
): void {
  const file = settingsPath(userDataDir);
  const settings = fs.existsSync(file)
    ? JSON.parse(fs.readFileSync(file, "utf8"))
    : {};
  settings.githubAccessToken = {
    value: ciphertextBase64,
    encryptionType: "electron-safe-storage",
  };
  fs.writeFileSync(file, JSON.stringify(settings, null, 2));
}

function makeUserDataDir(label: string): string {
  const dir = path.join(
    os.tmpdir(),
    `dyad-e2e-safe-storage-${label}-${Date.now()}`,
  );
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// A well-formed (v10-prefixed) ciphertext that no key can decrypt. Its only
// job is to make readSettings() attempt a safeStorage decrypt at startup.
const UNDECRYPTABLE_CIPHERTEXT = Buffer.concat([
  Buffer.from("v10"),
  Buffer.alloc(16, 7),
]).toString("base64");

test.describe("safeStorage keychain identity (issue #3837)", () => {
  test.skip(
    !ENABLED,
    "Opt-in: requires macOS and DYAD_E2E_SAFE_STORAGE=1 (temporarily swaps the default keychain)",
  );

  test.beforeAll(() => {
    if (!ENABLED) return;
    originalDefaultKeychain = parseKeychainPaths(
      security(["default-keychain", "-d", "user"]),
    )[0];
    originalSearchList = parseKeychainPaths(
      security(["list-keychains", "-d", "user"]),
    );
  });

  test.afterAll(() => {
    if (!ENABLED) return;
    restoreOriginalKeychains();
  });

  test.beforeEach(() => {
    if (!ENABLED) return;
    freshTempKeychain();
  });

  test("Electron 40: first stored secret becomes unreadable after an app restart (pre-ready safeStorage race)", async () => {
    test.setTimeout(240_000);
    const userDataDir = makeUserDataDir("restart");
    const token = "gh_e2e_restart_secret";

    // Session 1: fresh profile, no secrets on disk. Nothing touches
    // safeStorage before app.ready, so the first touch (our encrypt) creates
    // the Keychain entry under the proper app identity.
    const session1 = await launchDyad({ userDataDir });
    const ciphertext = await encryptViaApp(session1, token);
    expect(await decryptViaApp(session1, ciphertext)).toBe(token);
    await closeDyad(session1);

    // Persist the secret the way writeSettings() would in a real
    // (non-test-build) session.
    writeGithubTokenCiphertext(userDataDir, ciphertext);

    // Session 2: the settings file now contains an encrypted secret, so the
    // module-scope reconcileCloudSandboxes() -> readSettings() call decrypts
    // BEFORE app.ready. On Electron 40 that silently initializes safeStorage
    // under the "Chromium Safe Storage" identity, which cannot decrypt the
    // ciphertext from session 1.
    freshTempKeychain();
    const session2 = await launchDyad({ userDataDir });

    // Root cause fingerprint: os_crypt on macOS is deterministic (fixed IV),
    // so the same plaintext encrypted by the same build must yield the same
    // ciphertext — unless the session derived its key from a different
    // Keychain identity. This restart flipped the identity.
    expect(await encryptViaApp(session2, token)).not.toBe(ciphertext);

    // BUG: the same app build can no longer read what it encrypted one
    // restart ago.
    expect(await decryptViaApp(session2, ciphertext)).toMatch(/^ERROR: /);

    // BUG: readSettings() drops the undecryptable secret, so the stored
    // GitHub token is gone from the app's point of view.
    const settings = await readSettingsViaIpc(session2);
    expect(settings.githubAccessToken).toBeFalsy();

    await closeDyad(session2);
  });

  test("Electron 40 -> 43 upgrade: steady-state secrets become unreadable (#3837)", async () => {
    test.skip(
      !UPGRADE_BUILD_DIR,
      "Set DYAD_E2E_SAFE_STORAGE_UPGRADE_BUILD to a packaged build dir (e.g. out/dyad-darwin-arm64) built at the Electron 43 commit (parent of revert d24360e8)",
    );
    test.setTimeout(240_000);
    const userDataDir = makeUserDataDir("upgrade");
    const token = "gh_e2e_upgrade_secret";

    // Steady state for a long-time Electron 40 user: the settings file
    // already holds an electron-safe-storage secret at launch, so every
    // session initializes safeStorage pre-ready under the Chromium identity.
    // The seeded value only needs to trigger that decrypt attempt.
    writeGithubTokenCiphertext(userDataDir, UNDECRYPTABLE_CIPHERTEXT);

    // Session 1 (Electron 40): encrypt the real token. Because this session
    // was poisoned pre-ready, the ciphertext is bound to the Chromium
    // identity.
    const session1 = await launchDyad({ userDataDir });
    const ciphertext = await encryptViaApp(session1, token);
    await closeDyad(session1);
    writeGithubTokenCiphertext(userDataDir, ciphertext);

    // Session 2 (Electron 40 control): restarts on the same Electron major
    // keep working — same pre-ready race, same wrong-but-stable identity.
    // This is why the bug stays invisible until the Electron upgrade.
    freshTempKeychain();
    const session2 = await launchDyad({ userDataDir });
    expect(await decryptViaApp(session2, ciphertext)).toBe(token);
    const settingsOn40 = await readSettingsViaIpc(session2);
    expect(settingsOn40.githubAccessToken?.value).toBe(token);
    await closeDyad(session2);

    // Session 2 may have rewritten the settings file, and test builds store
    // secrets as plaintext on write (encrypt() checks IS_TEST_BUILD). A real
    // build re-encrypts with safeStorage, so put the ciphertext back to match
    // the on-disk state a production Electron 40 install carries into the
    // upgrade.
    writeGithubTokenCiphertext(userDataDir, ciphertext);

    // Session 3 (Electron 43 build): safeStorage now refuses pre-ready use
    // and post-ready always uses the proper "dyad Safe Storage" identity, so
    // the Chromium-identity ciphertext is permanently unreadable.
    freshTempKeychain();
    const session3 = await launchDyad({
      userDataDir,
      buildDir: UPGRADE_BUILD_DIR,
    });

    // BUG (#3837): the stored secret cannot be decrypted after the upgrade...
    expect(await decryptViaApp(session3, ciphertext)).toMatch(/^ERROR: /);

    // ...and the app silently drops it (user-visible: GitHub disconnected,
    // provider API keys gone).
    const settingsOn43 = await readSettingsViaIpc(session3);
    expect(settingsOn43.githubAccessToken).toBeFalsy();

    await closeDyad(session3);
  });
});
