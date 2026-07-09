/**
 * Regression tests for https://github.com/dyad-sh/dyad/issues/3837: secrets
 * encrypted with Electron safeStorage on macOS were becoming unreadable after
 * upgrading from Electron 40 to Electron 43 (and, more generally, whenever a
 * session resolved a different Keychain identity than the one a secret was
 * encrypted under).
 *
 * Background (the bug these tests now guard against):
 * - `registerAppHandlers()` fires `reconcileCloudSandboxes()` at module scope
 *   (src/ipc/handlers/app_handlers.ts), which calls `readSettings()` BEFORE
 *   `app.whenReady()`. When the settings file contains an
 *   `electron-safe-storage` secret, decrypting it touches safeStorage
 *   pre-ready.
 * - On Electron 40, a pre-ready safeStorage call silently initializes the
 *   macOS Keychain entry under the default "Chromium Safe Storage" identity
 *   instead of "dyad Safe Storage", and that (wrong) key is cached for the
 *   rest of the process.
 * - On Electron 43, safeStorage refuses to run pre-ready and post-ready always
 *   uses the proper "dyad Safe Storage" identity — so ciphertext produced under
 *   the Chromium identity could never be decrypted again after the upgrade, and
 *   the old code then DROPPED the undecryptable secret (GitHub disconnected,
 *   provider API keys gone).
 *
 * The fix (this PR) does NOT remove the pre-ready identity-flip race — that is
 * deliberately left in place — but makes the stored secret survive it:
 * - Layer 0 (settings.ts): a secret that fails to decrypt is no longer dropped.
 *   It is absent from `get-user-settings` (locked, not usable) but its
 *   ciphertext is preserved VERBATIM in user-settings.json across subsequent
 *   settings writes, so it stays recoverable.
 * - Layer 1 (legacy keychain recovery): when safeStorage decrypt fails on
 *   darwin, the app reads the Keychain passwords of BOTH legacy identities via
 *   the `security` CLI ("dyad Safe Storage"/"dyad" and
 *   "Chromium Safe Storage"/"Chromium"), derives the Chromium os_crypt key
 *   (PBKDF2-HMAC-SHA1, salt "saltysalt", 1003 iterations, 16 bytes ->
 *   AES-128-CBC, IV = 16 spaces, "v10" prefix) and decrypts. A secret encrypted
 *   under one identity is then transparently recovered in a session that
 *   resolved the other. Kill switch: DYAD_DISABLE_SAFE_STORAGE_RECOVERY=1.
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
 * Usage (the regression tests need only the normal e2e build in out/):
 *
 *   npm run pre:e2e
 *   DYAD_E2E_SAFE_STORAGE=1 npx playwright test \
 *     e2e-tests/safe_storage_keychain_identity.spec.ts --workers=1
 *
 * The two-build upgrade test additionally needs a build of the app at the
 * Electron 43 commit (the parent of the revert
 * d24360e89ba54cd8386d5148a74437df10ced414, e.g. in a worktree:
 * `git checkout d24360e8~1 && npm ci && npm run pre:e2e`). Note that commit
 * PREDATES this fix, so it still exhibits the old dropping behavior (see the
 * test's own comments). Point at its packaged output:
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
  // accessed by an unsigned binary. The Layer 1 recovery reads these same
  // items via the `security` CLI (the -A ACL lets it read them without a
  // prompt), which is what makes the fallback exercisable in this environment.
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

async function writeSettingsViaIpc(
  electronApp: ElectronApplication,
  partial: Record<string, unknown>,
): Promise<any> {
  const page = await electronApp.firstWindow();
  return page.evaluate(
    (p) => (window as any).electron.ipcRenderer.invoke("set-user-settings", p),
    partial,
  );
}

function settingsPath(userDataDir: string): string {
  return path.join(userDataDir, "user-settings.json");
}

function readSettingsFileRaw(userDataDir: string): any {
  return JSON.parse(fs.readFileSync(settingsPath(userDataDir), "utf8"));
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

  test("stored secret survives the pre-ready identity flip across restarts (Layer 1 recovery)", async () => {
    test.setTimeout(240_000);
    const userDataDir = makeUserDataDir("restart");
    const token = "gh_e2e_restart_secret";

    // Session 1: fresh profile, no secrets on disk. Nothing touches
    // safeStorage before app.ready, so the first touch (our encrypt) creates
    // the Keychain entry under the proper "dyad Safe Storage" identity.
    const session1 = await launchDyad({ userDataDir });
    const ciphertext = await encryptViaApp(session1, token);
    expect(await decryptViaApp(session1, ciphertext)).toBe(token);
    await closeDyad(session1);

    // Persist the secret the way writeSettings() would in a real
    // (non-test-build) session.
    writeGithubTokenCiphertext(userDataDir, ciphertext);

    // Session 2: the settings file now contains an encrypted secret, so the
    // module-scope reconcileCloudSandboxes() -> readSettings() call decrypts
    // BEFORE app.ready. That pre-ready race silently resolves the "Chromium
    // Safe Storage" identity, which cannot decrypt the dyad-identity ciphertext
    // from session 1. This race is deliberately left unfixed; the fix instead
    // makes the secret survive it.
    freshTempKeychain();
    const session2 = await launchDyad({ userDataDir });

    // The identity flip still happens: os_crypt on macOS is deterministic
    // (fixed IV), so the same plaintext encrypted by the same build must yield
    // the same ciphertext — unless the session derived its key from a different
    // Keychain identity. A mismatch proves session 2 resolved a different
    // identity than session 1.
    expect(await encryptViaApp(session2, token)).not.toBe(ciphertext);

    // ...and raw safeStorage STILL cannot read the session-1 ciphertext,
    // confirming the flip is real and that the recovery below (not safeStorage)
    // is what makes the token readable again.
    expect(await decryptViaApp(session2, ciphertext)).toMatch(/^ERROR: /);

    // REGRESSION: despite the flip, the stored GitHub token is recovered via
    // the Layer 1 legacy-keychain fallback and IS returned to the app.
    //
    // No assertion on the settings file here: e2e builds write secrets as
    // plaintext (IS_TEST_BUILD), so a mid-session settings write may legitimately
    // convert the recovered secret to plaintext on disk. IPC-level only.
    const settings = await readSettingsViaIpc(session2);
    expect(settings.githubAccessToken?.value).toBe(token);

    await closeDyad(session2);

    // Session 3: a completely fresh keychain over the same profile. Guards
    // against the recovery in session 2 having corrupted the stored value — the
    // token must still be readable via IPC.
    freshTempKeychain();
    const session3 = await launchDyad({ userDataDir });
    const settings3 = await readSettingsViaIpc(session3);
    expect(settings3.githubAccessToken?.value).toBe(token);
    await closeDyad(session3);
  });

  test("Layer 0: an undecryptable secret is locked but preserved verbatim across writes", async () => {
    test.setTimeout(240_000);
    const userDataDir = makeUserDataDir("preserve");

    // Seed a v10-prefixed ciphertext that no key in this environment can
    // decrypt (unlike the recovery test, there is no matching identity to fall
    // back to — this is a genuinely unreadable secret).
    writeGithubTokenCiphertext(userDataDir, UNDECRYPTABLE_CIPHERTEXT);

    // Session 1: launch, then force a real settings write through the app by
    // flipping a harmless boolean that does NOT touch githubAccessToken.
    const session1 = await launchDyad({ userDataDir });
    await writeSettingsViaIpc(session1, {
      hidePnpmMinimumReleaseAgeWarning: true,
    });

    // The undecryptable secret is locked: absent from the app's view, not
    // usable.
    const settings1 = await readSettingsViaIpc(session1);
    expect(settings1.githubAccessToken).toBeFalsy();
    // Sanity: the harmless write did land in the app's view.
    expect(settings1.hidePnpmMinimumReleaseAgeWarning).toBe(true);
    await closeDyad(session1);

    // Preservation crux: even though a settings write happened (proven by the
    // harmless field), the undecryptable ciphertext is still on disk EXACTLY as
    // seeded — not dropped, not re-encrypted (a test build would otherwise
    // re-encrypt it as plaintext). This is what keeps it recoverable later.
    const onDisk = readSettingsFileRaw(userDataDir);
    expect(onDisk.hidePnpmMinimumReleaseAgeWarning).toBe(true);
    expect(onDisk.githubAccessToken?.value).toBe(UNDECRYPTABLE_CIPHERTEXT);
    expect(onDisk.githubAccessToken?.encryptionType).toBe(
      "electron-safe-storage",
    );

    // Replacement still works: explicitly setting a new token overwrites the
    // preserved-but-unreadable secret. In a test build encrypt() stores
    // plaintext, so the fresh value lands verbatim.
    freshTempKeychain();
    const session2 = await launchDyad({ userDataDir });
    await writeSettingsViaIpc(session2, {
      githubAccessToken: { value: "fresh-token", encryptionType: "plaintext" },
    });
    const settings2 = await readSettingsViaIpc(session2);
    expect(settings2.githubAccessToken?.value).toBe("fresh-token");
    await closeDyad(session2);

    const afterReplace = readSettingsFileRaw(userDataDir);
    expect(afterReplace.githubAccessToken?.value).toBe("fresh-token");
    expect(afterReplace.githubAccessToken?.value).not.toBe(
      UNDECRYPTABLE_CIPHERTEXT,
    );
  });

  test("Electron 40 -> 43 upgrade: pre-fix build still drops steady-state secrets (#3837)", async () => {
    test.skip(
      !UPGRADE_BUILD_DIR,
      "Set DYAD_E2E_SAFE_STORAGE_UPGRADE_BUILD to a packaged build dir (e.g. out/dyad-darwin-arm64) built at the Electron 43 commit (parent of revert d24360e8)",
    );
    test.setTimeout(240_000);
    const userDataDir = makeUserDataDir("upgrade");
    const token = "gh_e2e_upgrade_secret";

    // NOTE: the upgrade build (DYAD_E2E_SAFE_STORAGE_UPGRADE_BUILD) is built at
    // the Electron 43 commit that PREDATES this fix, so it still exhibits the
    // old dropping behavior — hence session 3 below asserts the secret is lost.
    // Once the Electron 43 re-land (which will carry this fix) provides the
    // artifact, flip session 3's assertions to expect Layer 1 recovery instead
    // (token decryptable via IPC, githubAccessToken present), mirroring the
    // "survives the pre-ready identity flip" test above.

    // Steady state for a long-time Electron 40 user: the settings file already
    // holds an electron-safe-storage secret at launch, so every session
    // initializes safeStorage pre-ready under the Chromium identity. The seeded
    // value only needs to trigger that decrypt attempt.
    writeGithubTokenCiphertext(userDataDir, UNDECRYPTABLE_CIPHERTEXT);

    // Session 1 (Electron 40): encrypt the real token. Because this session was
    // poisoned pre-ready, the ciphertext is bound to the Chromium identity.
    const session1 = await launchDyad({ userDataDir });
    const ciphertext = await encryptViaApp(session1, token);
    await closeDyad(session1);
    writeGithubTokenCiphertext(userDataDir, ciphertext);

    // Session 2 (Electron 40 control): restarts on the same Electron major keep
    // working — same pre-ready race, same wrong-but-stable Chromium identity, so
    // raw safeStorage still decrypts the ciphertext. This is why the bug stays
    // invisible until the Electron upgrade.
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

    // Session 3 (Electron 43, pre-fix build): safeStorage now refuses pre-ready
    // use and post-ready always uses the proper "dyad Safe Storage" identity, so
    // the Chromium-identity ciphertext is permanently unreadable — and because
    // this build predates the fix, it has neither Layer 0 preservation nor
    // Layer 1 recovery.
    freshTempKeychain();
    const session3 = await launchDyad({
      userDataDir,
      buildDir: UPGRADE_BUILD_DIR,
    });

    // BUG (#3837), reproduced against the pre-fix build: the stored secret
    // cannot be decrypted after the upgrade...
    expect(await decryptViaApp(session3, ciphertext)).toMatch(/^ERROR: /);

    // ...and the pre-fix app silently drops it (user-visible: GitHub
    // disconnected, provider API keys gone).
    const settingsOn43 = await readSettingsViaIpc(session3);
    expect(settingsOn43.githubAccessToken).toBeFalsy();

    await closeDyad(session3);
  });
});
