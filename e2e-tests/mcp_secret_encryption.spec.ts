/**
 * End-to-end coverage for MCP secret encryption at rest.
 *
 * Unit tests mock `safeStorage`, so they prove the plumbing calls the
 * right functions but not that anything is really encrypted. These run
 * against a packaged app and assert on the database file on disk, so
 * they exercise whichever backend the host provides: Keychain on
 * macOS, DPAPI on Windows, libsecret on Linux. A host with no keyring
 * reports them as skipped, since there is no ciphertext to inspect.
 */

import fs from "fs";
import path from "path";
import { expect } from "@playwright/test";

import {
  test,
  testSkipIfWindows,
  testWithConfigSkipIfWindows,
} from "./helpers/test_helper";

// Marks a blob that safeStorage could not encrypt, mirroring the tag
// used in src/ipc/utils/secret_storage.ts.
const PLAINTEXT_PREFIX = "plain:";

const NEW_SERVER_NAME = "encryption-test-server";
const NEW_SECRET = "greenfield-stdio-secret-1a2b3c";
// Both match the row stored in the fixture database.
const LEGACY_SERVER_NAME = "legacy-plaintext-server";
const LEGACY_SECRET = "brownfield-legacy-secret-9z8y7x";

type StoredSecrets = {
  envJson: string | null;
  envEncrypted: string | null;
  headersJson: string | null;
  headersEncrypted: string | null;
};

/**
 * Reads a server's secret columns straight out of the database.
 *
 * `better-sqlite3` has to match the ABI of the process running this
 * test, which it does in CI because that job installs dependencies
 * fresh. Locally, `npm run pre:e2e` rebuilds it for Electron, so run
 * `npm rebuild better-sqlite3` before running this spec by hand.
 */
async function readStoredSecrets(
  userDataDir: string,
  serverName: string,
  waitForColumn: keyof StoredSecrets,
): Promise<StoredSecrets> {
  const { default: Database } = await import("better-sqlite3");
  const dbPath = path.join(userDataDir, "sqlite.db");
  const deadline = Date.now() + 15_000;
  let last: StoredSecrets = {
    envJson: null,
    envEncrypted: null,
    headersJson: null,
    headersEncrypted: null,
  };
  // Both the startup pass and the save handler write in the
  // background, so poll until the column we care about lands.
  while (Date.now() < deadline) {
    const db = new Database(dbPath, { readonly: true });
    try {
      last =
        (db
          .prepare(
            `SELECT env_json AS envJson,
                    env_encrypted AS envEncrypted,
                    headers_json AS headersJson,
                    headers_encrypted AS headersEncrypted
             FROM mcp_servers WHERE name = ?`,
          )
          .get(serverName) as StoredSecrets | undefined) ?? last;
    } finally {
      db.close();
    }
    if (last[waitForColumn]) return last;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return last;
}

/**
 * Asserts a stored blob is real ciphertext rather than the base64
 * `plain:` fallback. Checking for the tag matters: without it these
 * tests would pass on a host with no keyring, where the secret is
 * merely base64 and nothing is encrypted at all.
 *
 * A host without a keyring reports the test as skipped rather than
 * failing it, since there is no ciphertext to inspect there.
 */
function expectRealCiphertext(blob: string | null, secret: string): void {
  expect(blob).not.toBeNull();
  test.skip(
    blob!.startsWith(PLAINTEXT_PREFIX),
    "No OS keyring on this host, so secrets fall back to base64",
  );
  expect(blob).not.toContain(secret);
  expect(Buffer.from(blob!, "base64").toString("utf8")).not.toContain(secret);
}

function readDatabaseBytes(userDataDir: string): Buffer {
  const dbPath = path.join(userDataDir, "sqlite.db");
  // The write-ahead log holds recent writes that haven't been folded
  // into the main file yet, so a secret could hide there.
  return Buffer.concat(
    [dbPath, `${dbPath}-wal`]
      .filter((p) => fs.existsSync(p))
      .map((p) => fs.readFileSync(p)),
  );
}

testSkipIfWindows(
  "mcp secrets - a new server's env vars are only ever stored encrypted",
  async ({ po }) => {
    await po.setUp();
    await po.navigation.goToPluginsTab();
    await po.plugins.openAddPluginDialog();

    await po.page
      .getByRole("textbox", { name: "My MCP Server" })
      .fill(NEW_SERVER_NAME);
    await po.page.getByRole("textbox", { name: "node" }).fill("node");
    await po.page
      .getByRole("textbox", { name: "path/to/mcp-server.js --flag" })
      .fill(path.join(__dirname, "..", "testing", "fake-stdio-mcp-server.mjs"));
    await po.plugins.submitAddPluginDialog();

    await po.plugins.openPluginDetail(NEW_SERVER_NAME);
    const detail = po.page.getByTestId("plugin-detail");
    await detail
      .getByRole("button", { name: "Add Environment Variable" })
      .click();
    await detail.getByRole("textbox", { name: "Key" }).fill("API_KEY");
    await detail.getByRole("textbox", { name: "Value" }).fill(NEW_SECRET);
    await detail.getByRole("button", { name: "Save" }).click();

    // The value round-trips through the renderer, so it is readable
    // only if the stored ciphertext actually decrypts.
    await expect(detail.getByText(NEW_SECRET)).toBeVisible();

    const stored = await readStoredSecrets(
      po.userDataDir,
      NEW_SERVER_NAME,
      "envEncrypted",
    );
    expectRealCiphertext(stored.envEncrypted, NEW_SECRET);
    // Nothing created on this build should populate the legacy column.
    expect(stored.envJson).toBeNull();

    expect(readDatabaseBytes(po.userDataDir).includes(NEW_SECRET)).toBe(false);
  },
);

const testWithLegacyDb = testWithConfigSkipIfWindows({
  preLaunchHook: async ({ userDataDir }) => {
    fs.mkdirSync(userDataDir, { recursive: true });
    fs.copyFileSync(
      path.join(
        __dirname,
        "fixtures",
        "mcp",
        "plaintext-headers-pre-encryption.db",
      ),
      path.join(userDataDir, "sqlite.db"),
    );
  },
});

testWithLegacyDb(
  "mcp secrets - headers stored by an older build are encrypted on startup",
  async ({ po }) => {
    await po.setUp();
    await po.navigation.goToPluginsTab();
    await po.plugins.openPluginDetail(LEGACY_SERVER_NAME);
    const detail = po.page.getByTestId("plugin-detail");

    // Readable only if the header survived the migration and decrypts.
    await expect(detail.getByText(LEGACY_SECRET)).toBeVisible();

    const stored = await readStoredSecrets(
      po.userDataDir,
      LEGACY_SERVER_NAME,
      "headersEncrypted",
    );
    expectRealCiphertext(stored.headersEncrypted, LEGACY_SECRET);

    // The plaintext column is deliberately left alone so a build
    // predating the encrypted columns keeps working.
    expect(stored.headersJson).toContain(LEGACY_SECRET);
  },
);
