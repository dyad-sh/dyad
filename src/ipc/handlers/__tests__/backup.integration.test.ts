// @vitest-environment node
//
// Migrated from e2e-tests/backup.spec.ts.
//
// The e2e test launched Electron with pre-seeded userData dirs and asserted
// the BackupManager's startup behavior. That behavior lives entirely in
// src/backup_manager.ts (`BackupManager.initialize()`, invoked from main.ts
// with getSettingsFilePath()/getDatabasePath() before the db is initialized).
// No chat flow / LLM is involved, so this test runs the real BackupManager
// against per-test temp userData dirs with only `electron` mocked
// (app.getPath("userData") resolves via DYAD_DEV_USER_DATA_DIR and
// app.getVersion() returns "0.0.0-test").
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  process.env.NODE_ENV = "development";
  return { ipcHandlers: new Map() };
});

vi.mock("electron", async () => {
  const { createElectronMock } = await import("@/testing/electron_mock");
  return createElectronMock(h);
});

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { BackupManager } from "@/backup_manager";
import { getDatabasePath } from "@/db";
import { getSettingsFilePath } from "@/main/settings";

// The mocked electron app.getVersion() value (see electron_mock.ts).
const CURRENT_VERSION = "0.0.0-test";
const BACKUP_SETTINGS = { testFixture: true };
const SQLITE_FIXTURE = path.join(
  process.cwd(),
  "e2e-tests",
  "fixtures",
  "backups",
  "empty-v0.12.0-beta.1.db",
);

function calculateChecksum(filePath: string): string {
  const fileBuffer = fs.readFileSync(filePath);
  const hash = crypto.createHash("sha256");
  hash.update(fileBuffer);
  return hash.digest("hex");
}

describe("backup manager (integration)", () => {
  let userDataDir: string;

  const initializeBackupManager = async () => {
    // Mirrors main.ts: the BackupManager is constructed with the settings and
    // db file paths and initialized before the database is opened.
    const backupManager = new BackupManager({
      settingsFile: getSettingsFilePath(),
      dbFile: getDatabasePath(),
    });
    await backupManager.initialize();
  };

  beforeEach(() => {
    userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "dyad-backup-test-"));
    process.env.DYAD_DEV_USER_DATA_DIR = userDataDir;
  });

  afterEach(() => {
    fs.rmSync(userDataDir, { recursive: true, force: true });
    delete process.env.DYAD_DEV_USER_DATA_DIR;
  });

  it("backup is not created for first run", async () => {
    // No .last_version file → first run → no backup.
    await initializeBackupManager();

    expect(fs.existsSync(path.join(userDataDir, "backups"))).toBe(false);
  });

  it("backup is created if version is upgraded", async () => {
    fs.writeFileSync(path.join(userDataDir, ".last_version"), "0.1.0");
    fs.copyFileSync(SQLITE_FIXTURE, path.join(userDataDir, "sqlite.db"));
    fs.writeFileSync(
      path.join(userDataDir, "user-settings.json"),
      JSON.stringify(BACKUP_SETTINGS, null, 2),
    );

    await initializeBackupManager();

    const backups = fs.readdirSync(path.join(userDataDir, "backups"));
    expect(backups).toHaveLength(1);
    const backupDir = path.join(userDataDir, "backups", backups[0]);
    const backupMetadata = JSON.parse(
      fs.readFileSync(path.join(backupDir, "backup.json"), "utf8"),
    );

    expect(backupMetadata.version).toBe(CURRENT_VERSION);
    expect(backupMetadata.timestamp).toBeDefined();
    expect(backupMetadata.reason).toBe("upgrade_from_0.1.0");
    expect(backupMetadata.files.settings).toBe(true);
    expect(backupMetadata.files.database).toBe(true);
    expect(backupMetadata.checksums.settings).toBeDefined();
    expect(backupMetadata.checksums.database).toBeDefined();

    // The backed-up settings are byte-identical to the original file.
    const backupSettings = fs.readFileSync(
      path.join(backupDir, "user-settings.json"),
      "utf8",
    );
    expect(backupSettings).toEqual(JSON.stringify(BACKUP_SETTINGS, null, 2));

    // The database backup exists, the original is untouched, and the metadata
    // checksum matches the backup file.
    const backupDbPath = path.join(backupDir, "sqlite.db");
    const originalDbPath = path.join(userDataDir, "sqlite.db");
    expect(fs.existsSync(backupDbPath)).toBe(true);
    expect(fs.existsSync(originalDbPath)).toBe(true);
    expect(backupMetadata.checksums.database).toBe(
      calculateChecksum(backupDbPath),
    );

    // The current version is recorded so the next run is not an "upgrade".
    expect(
      fs.readFileSync(path.join(userDataDir, ".last_version"), "utf8").trim(),
    ).toBe(CURRENT_VERSION);
  });

  it("backup cleanup deletes oldest backups when exceeding MAX_BACKUPS", async () => {
    fs.writeFileSync(path.join(userDataDir, ".last_version"), "0.1.0");
    fs.writeFileSync(
      path.join(userDataDir, "user-settings.json"),
      JSON.stringify(BACKUP_SETTINGS, null, 2),
    );
    // NOTE: intentionally no sqlite.db — in production the backup manager runs
    // before the database is initialized on a fresh userData dir.

    // Create 5 mock backup directories with ascending timestamps.
    const backupsDir = path.join(userDataDir, "backups");
    fs.mkdirSync(backupsDir, { recursive: true });
    const mockBackups = [
      {
        name: "v1.0.0_2023-01-01T10-00-00-000Z_upgrade_from_0.9.0",
        timestamp: "2023-01-01T10:00:00.000Z",
        version: "1.0.0",
        reason: "upgrade_from_0.9.0",
      },
      {
        name: "v1.0.1_2023-01-02T10-00-00-000Z_upgrade_from_1.0.0",
        timestamp: "2023-01-02T10:00:00.000Z",
        version: "1.0.1",
        reason: "upgrade_from_1.0.0",
      },
      {
        name: "v1.0.2_2023-01-03T10-00-00-000Z_upgrade_from_1.0.1",
        timestamp: "2023-01-03T10:00:00.000Z",
        version: "1.0.2",
        reason: "upgrade_from_1.0.1",
      },
      {
        name: "v1.0.3_2023-01-04T10-00-00-000Z_upgrade_from_1.0.2",
        timestamp: "2023-01-04T10:00:00.000Z",
        version: "1.0.3",
        reason: "upgrade_from_1.0.2",
      },
      {
        name: "v1.0.4_2023-01-05T10-00-00-000Z_upgrade_from_1.0.3",
        timestamp: "2023-01-05T10:00:00.000Z",
        version: "1.0.4",
        reason: "upgrade_from_1.0.3",
      },
    ];

    for (const backup of mockBackups) {
      const backupPath = path.join(backupsDir, backup.name);
      fs.mkdirSync(backupPath, { recursive: true });
      fs.writeFileSync(
        path.join(backupPath, "backup.json"),
        JSON.stringify(
          {
            version: backup.version,
            timestamp: backup.timestamp,
            reason: backup.reason,
            files: { settings: true, database: true },
            checksums: {
              settings: "mock_settings_checksum_" + backup.version,
              database: "mock_database_checksum_" + backup.version,
            },
          },
          null,
          2,
        ),
      );
      fs.writeFileSync(
        path.join(backupPath, "user-settings.json"),
        JSON.stringify({ version: backup.version, mockData: true }, null, 2),
      );
      fs.writeFileSync(
        path.join(backupPath, "sqlite.db"),
        `mock_database_content_${backup.version}`,
      );
    }

    await initializeBackupManager();

    const backups = fs.readdirSync(backupsDir);

    // Should have only 3 backups remaining (MAX_BACKUPS = 3).
    expect(backups).toHaveLength(3);

    const expectedRemainingBackups = [
      "*", // the freshly created upgrade backup
      "v1.0.4_2023-01-05T10-00-00-000Z_upgrade_from_1.0.3",
      "v1.0.3_2023-01-04T10-00-00-000Z_upgrade_from_1.0.2",
    ];

    for (const backup of expectedRemainingBackups) {
      let expectedBackup = backup;
      if (backup === "*") {
        const upgradeBackup = backups.find((name) =>
          name.endsWith("_upgrade_from_0.1.0"),
        );
        expect(upgradeBackup).toBeDefined();
        expectedBackup = upgradeBackup!;
      } else {
        expect(backups).toContain(expectedBackup);
      }

      const backupPath = path.join(backupsDir, expectedBackup);
      expect(fs.existsSync(backupPath)).toBe(true);
      expect(fs.existsSync(path.join(backupPath, "backup.json"))).toBe(true);
      expect(fs.existsSync(path.join(backupPath, "user-settings.json"))).toBe(
        true,
      );

      // The new backup does NOT have a SQLite database because the backup
      // manager runs before the DB is initialized.
      expect(fs.existsSync(path.join(backupPath, "sqlite.db"))).toBe(
        backup !== "*",
      );
    }

    // The 3 oldest backups should have been deleted.
    const deletedBackups = [
      "v1.0.0_2023-01-01T10-00-00-000Z_upgrade_from_0.9.0",
      "v1.0.1_2023-01-02T10-00-00-000Z_upgrade_from_1.0.0",
      "v1.0.2_2023-01-03T10-00-00-000Z_upgrade_from_1.0.1",
    ];
    for (const deletedBackup of deletedBackups) {
      expect(backups).not.toContain(deletedBackup);
      expect(fs.existsSync(path.join(backupsDir, deletedBackup))).toBe(false);
    }
  });
});
