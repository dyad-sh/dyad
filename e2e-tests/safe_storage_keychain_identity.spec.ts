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
 * The candidate defers reconciliation until ready, while the pinned baseline
 * retains the old race so it can produce both historical identities. Keep
 * recovery for users carrying ciphertext from the old startup order:
 * - Layer 0 (settings.ts): a secret that fails to decrypt is no longer dropped.
 *   It is absent from `get-user-settings` (locked, not usable) but its
 *   ciphertext is preserved VERBATIM in user-settings.json across subsequent
 *   settings writes, so it stays recoverable.
 * - Layer 1 (legacy keychain recovery): when safeStorage decrypt fails on
 *   darwin, the app reads the Keychain passwords of BOTH legacy identities via
 *   the in-process reader ("dyad Safe Storage"/"dyad Key" and
 *   "Chromium Safe Storage"/"Chromium Key"), derives the Chromium os_crypt key
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
 * CI builds a pinned Electron 40 baseline in a second checkout and reuses the
 * current PR artifact as the candidate. To run locally ON A DISPOSABLE MAC:
 *
 * DYAD_E2E_SAFE_STORAGE=1 \
 * DYAD_E2E_SAFE_STORAGE_BASELINE_BUILD=/path/to/baseline/out \
 * DYAD_E2E_SAFE_STORAGE_CANDIDATE_BUILD=/path/to/candidate/out \
 * npx playwright test e2e-tests/safe_storage_keychain_identity.spec.ts --workers=1
 *
 * Prepare the baseline with scripts/prepare-safe-storage-baseline.mjs before
 * building it. Both build paths point to out/, not its architecture child.
 */

import { expect, test } from "@playwright/test";
import { execFileSync } from "child_process";
import { createCipheriv, pbkdf2Sync } from "node:crypto";
import * as eph from "electron-playwright-helpers";
import fs from "fs";
import os from "os";
import path from "path";
import { ElectronApplication, _electron as electron } from "playwright";

const ENABLED =
  process.platform === "darwin" && process.env.DYAD_E2E_SAFE_STORAGE === "1";

const BASELINE_BUILD_DIR = process.env.DYAD_E2E_SAFE_STORAGE_BASELINE_BUILD;
const CANDIDATE_BUILD_DIR = process.env.DYAD_E2E_SAFE_STORAGE_CANDIDATE_BUILD;

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
const launchedApps = new Set<ElectronApplication>();

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
  // items via the native reader (the -A ACL lets it read them without a
  // prompt), which is what makes the fallback exercisable in this environment.
  for (const [service, account, password] of [
    [CHROMIUM_SERVICE, "Chromium Key", "e2e-chromium-identity-key"],
    [DYAD_SERVICE, "dyad Key", "e2e-dyad-identity-key"],
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
  realEncryption = false,
}: {
  userDataDir: string;
  buildDir?: string;
  realEncryption?: boolean;
}): Promise<ElectronApplication> {
  const outputDir = buildDir ?? CANDIDATE_BUILD_DIR;
  // findLatestBuild accepts the out/ directory; parseElectronApp expects its
  // platform/architecture child. Never let the nested baseline win discovery.
  const appInfo = eph.parseElectronApp(eph.findLatestBuild(outputDir));
  const electronApp = await electron.launch({
    args: [appInfo.main, "--enable-logging", `--user-data-dir=${userDataDir}`],
    executablePath: appInfo.executable,
    env: {
      ...process.env,
      E2E_TEST_BUILD: "true",
      DYAD_E2E_REAL_ENCRYPTION: realEncryption ? "true" : "false",
      // Skips the AI setup screen (same hack as the shared fixture).
      OPENAI_API_KEY: "sk-test",
    },
  });
  launchedApps.add(electronApp);
  try {
    // Ensures the app is fully ready before main-process evaluate calls.
    await electronApp.firstWindow();
    return electronApp;
  } catch (error) {
    await closeDyad(electronApp);
    throw error;
  }
}

async function closeDyad(electronApp: ElectronApplication): Promise<void> {
  launchedApps.delete(electronApp);
  const child = electronApp.process();
  try {
    await Promise.race([
      electronApp.close().catch(() => undefined),
      new Promise<void>((resolve) => setTimeout(resolve, 15_000)),
    ]);
  } finally {
    if (child.pid && child.exitCode === null && !child.signalCode) {
      child.kill("SIGKILL");
    }
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

function legacyCiphertext(text: string, identity: "Chromium" | "dyad"): string {
  const cipher = createCipheriv(
    "aes-128-cbc",
    pbkdf2Sync(
      `e2e-${identity.toLowerCase()}-identity-key`,
      "saltysalt",
      1003,
      16,
      "sha1",
    ),
    Buffer.alloc(16, 0x20),
  );
  return Buffer.concat([
    Buffer.from("v10"),
    cipher.update(text, "utf8"),
    cipher.final(),
  ]).toString("base64");
}

async function invokeApp<T>(
  app: ElectronApplication,
  channel: string,
  input?: unknown,
): Promise<T> {
  const page = await app.firstWindow();
  return page.evaluate(
    ({ channel, input }) =>
      (window as any).electron.ipcRenderer.invoke(channel, input),
    { channel, input },
  );
}

// Use the packaged app's SQLite binding inside Electron so the host Node ABI
// does not matter. This helper only seeds/inspects synthetic fixture bytes.
async function storedIntegrationSecrets(
  electronApp: ElectronApplication,
  userDataDir: string,
  serverId: number,
  seed?: { mixedEnv: string },
) {
  return electronApp.evaluate(
    ({ app, safeStorage }, params) => {
      const fs = process.getBuiltinModule("fs");
      const path = process.getBuiltinModule("path");
      const { createRequire } = process.getBuiltinModule("module");
      const require = createRequire(
        path.join(app.getAppPath(), "package.json"),
      );
      const Database = require("better-sqlite3");
      const database = new Database(path.join(params.userDataDir, "sqlite.db"));
      const subscriptionFile = path.join(
        params.userDataDir,
        "codex-subscription.enc",
      );
      try {
        if (params.seed) {
          const oauth = safeStorage
            .encryptString(
              JSON.stringify({
                tokens: {
                  access_token: "synthetic-mcp-access",
                  refresh_token: "synthetic-mcp-refresh",
                  token_type: "Bearer",
                },
                clientInformation: {
                  client_id: "synthetic-client",
                  client_secret: "synthetic-client-secret",
                },
              }),
            )
            .toString("base64");
          database
            .prepare(
              "UPDATE mcp_servers SET oauth_state = ?, env_encrypted = ? WHERE id = ?",
            )
            .run(oauth, params.seed.mixedEnv, params.serverId);
          fs.writeFileSync(
            subscriptionFile,
            safeStorage.encryptString(
              JSON.stringify({
                access: "synthetic-subscription-access",
                refresh: "synthetic-subscription-refresh",
                accountId: "synthetic-account",
                expires: Date.now() + 24 * 3600_000,
              }),
            ),
            { mode: 0o600 },
          );
        }
        return {
          row: database
            .prepare(
              "SELECT env_encrypted, headers_encrypted, oauth_state, oauth_client_secret FROM mcp_servers WHERE id = ?",
            )
            .get(params.serverId),
          subscription: fs.existsSync(subscriptionFile)
            ? fs.readFileSync(subscriptionFile).toString("base64")
            : null,
        };
      } finally {
        database.close();
      }
    },
    { userDataDir, serverId, seed },
  );
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

  test.afterEach(async () => {
    await Promise.all(
      [...launchedApps].map((electronApp) => closeDyad(electronApp)),
    );
  });

  test.beforeEach(() => {
    if (!ENABLED) return;
    freshTempKeychain();
  });

  test("stored secret survives restarts with or without the pre-ready identity race", async () => {
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

    // Moving reconciliation behind readiness keeps native encryption on dyad
    // even when the profile already holds encrypted settings.
    freshTempKeychain();
    const session2 = await launchDyad({ userDataDir });
    expect(await encryptViaApp(session2, token)).toBe(ciphertext);
    expect(await decryptViaApp(session2, ciphertext)).toBe(token);
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

  for (const identity of ["Chromium", "dyad"] as const) {
    test(`Electron 40 -> candidate: preserves encrypted ${identity} credentials through writes and restarts`, async () => {
      if (process.env.CI) {
        expect(
          BASELINE_BUILD_DIR,
          "CI must supply the baseline artifact",
        ).toBeTruthy();
        expect(
          CANDIDATE_BUILD_DIR,
          "CI must supply the candidate artifact",
        ).toBeTruthy();
      }
      test.skip(
        !BASELINE_BUILD_DIR,
        "Requires the pinned Electron 40 baseline out/ directory",
      );
      test.setTimeout(360_000);
      const userDataDir = makeUserDataDir(`upgrade-${identity}`);
      const token = `gh_e2e_upgrade_${identity}`;

      // A fresh old profile uses dyad. An encrypted entry at launch triggers
      // the historical pre-ready Chromium identity. The baseline retains that
      // behavior; the candidate is free to remove the race.
      if (identity === "Chromium") {
        writeGithubTokenCiphertext(userDataDir, UNDECRYPTABLE_CIPHERTEXT);
      }
      const baseline = await launchDyad({
        userDataDir,
        buildDir: BASELINE_BUILD_DIR,
        realEncryption: true,
      });
      expect(await baseline.evaluate(() => process.versions.electron)).toMatch(
        /^40\./,
      );
      await writeSettingsViaIpc(baseline, {
        githubAccessToken: { value: token, encryptionType: "plaintext" },
      });
      expect(
        (await readSettingsViaIpc(baseline)).githubAccessToken?.value,
      ).toBe(token);
      const server = await invokeApp<{ id: number }>(
        baseline,
        "mcp:create-server",
        {
          name: "keychain-upgrade-fixture",
          transport: "http",
          url: "https://example.invalid/mcp",
          enabled: false,
          oauthEnabled: true,
          oauthClientId: "synthetic-client",
          oauthClientSecret: "synthetic-client-secret",
          envJson: { FIXTURE_KEY: "synthetic-env" },
          headersJson: { Authorization: "Bearer synthetic-header" },
        },
      );
      const integrations = await storedIntegrationSecrets(
        baseline,
        userDataDir,
        server.id,
        {
          mixedEnv: legacyCiphertext(
            '{"FIXTURE_KEY":"synthetic-env"}',
            identity === "dyad" ? "Chromium" : "dyad",
          ),
        },
      );
      await closeDyad(baseline);

      // Prove the old app wrote real ciphertext under the intended identity,
      // rather than hand-installing encrypted bytes or accepting plaintext.
      const expectedCiphertext = legacyCiphertext(token, identity);
      expect(readSettingsFileRaw(userDataDir).githubAccessToken).toEqual({
        value: expectedCiphertext,
        encryptionType: "electron-safe-storage",
      });

      for (let restart = 0; restart < 3; restart++) {
        freshTempKeychain();
        const candidate = await launchDyad({
          userDataDir,
          realEncryption: true,
        });
        expect(
          (await readSettingsViaIpc(candidate)).githubAccessToken?.value,
        ).toBe(token);
        const servers = await invokeApp<
          Array<{
            id: number;
            envJson: unknown;
            headersJson: unknown;
            oauthConnected: boolean;
            envUnreadable: boolean;
            headersUnreadable: boolean;
          }>
        >(candidate, "mcp:list-servers");
        expect(servers.find((entry) => entry.id === server.id)).toMatchObject({
          envJson: { FIXTURE_KEY: "synthetic-env" },
          headersJson: { Authorization: "Bearer synthetic-header" },
          oauthConnected: true,
          envUnreadable: false,
          headersUnreadable: false,
        });
        expect(
          await invokeApp(candidate, "codex-subscription:status"),
        ).toMatchObject({ connected: true });
        await invokeApp(candidate, "mcp:update-server", {
          id: server.id,
          name: `keychain-upgrade-${restart}`,
        });
        await writeSettingsViaIpc(candidate, {
          hidePnpmMinimumReleaseAgeWarning: restart % 2 === 0,
        });
        expect(
          (await readSettingsViaIpc(candidate)).githubAccessToken?.value,
        ).toBe(token);
        expect(
          await storedIntegrationSecrets(candidate, userDataDir, server.id),
        ).toEqual(integrations);
        if (restart === 2) {
          await invokeApp(candidate, "mcp:disconnect-oauth", server.id);
          await invokeApp(candidate, "codex-subscription:disconnect");
          const afterDisconnect = await storedIntegrationSecrets(
            candidate,
            userDataDir,
            server.id,
          );
          expect(afterDisconnect.row.oauth_state).toBeNull();
          expect(afterDisconnect.subscription).toBeNull();
        }
        await closeDyad(candidate);
        const stored = readSettingsFileRaw(userDataDir);
        expect(stored.hidePnpmMinimumReleaseAgeWarning).toBe(restart % 2 === 0);
        expect(stored.githubAccessToken?.encryptionType).toBe(
          "electron-safe-storage",
        );
        expect(stored.githubAccessToken?.value).not.toBe(token);
        expect(
          Buffer.from(stored.githubAccessToken.value, "base64")
            .subarray(0, 3)
            .toString(),
        ).toBe("v10");
      }
    });
  }
});
