import * as path from "path";
import * as fs from "fs";
import * as crypto from "crypto";
import { testWithConfig, test, PageObject } from "./helpers/test_helper";
import { expect } from "@playwright/test";

const BACKUP_SETTINGS = { testFixture: true };
const testWithLastVersion = testWithConfig({
  preLaunchHook: async ({ userDataDir }) => {
    fs.mkdirSync(path.join(userDataDir), { recursive: true });
    fs.writeFileSync(path.join(userDataDir, ".last_version"), "0.1.0");
    fs.copyFileSync(
      path.join(__dirname, "fixtures", "backups", "empty-v0.12.0-beta.1.db"),
      path.join(userDataDir, "sqlite.db"),
    );
    fs.writeFileSync(
      path.join(userDataDir, "user-settings.json"),
      JSON.stringify(BACKUP_SETTINGS, null, 2),
    );
  },
});

const testWithMultipleBackups = testWithConfig({
  preLaunchHook: async ({ userDataDir }) => {
    fs.mkdirSync(path.join(userDataDir), { recursive: true });
    // Make sure there's a last version file so the version upgrade is detected.
    fs.writeFileSync(path.join(userDataDir, ".last_version"), "0.1.0");
    fs.writeFileSync(
      path.join(userDataDir, "user-settings.json"),
      JSON.stringify(BACKUP_SETTINGS, null, 2),
    );

    // Create backups directory
    const backupsDir = path.join(userDataDir, "backups");
    fs.mkdirSync(backupsDir, { recursive: true });

    // Create 5 mock backup directories with different timestamps
    // These timestamps are in ascending order (oldest to newest)
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

    // Create each backup directory with realistic structure
    for (const backup of mockBackups) {
      const backupPath = path.join(backupsDir, backup.name);
      fs.mkdirSync(backupPath, { recursive: true });

      // Create backup metadata
      const metadata = {
        version: backup.version,
        timestamp: backup.timestamp,
        reason: backup.reason,
        files: {
          settings: true,
          database: true,
        },
        checksums: {
          settings: "mock_settings_checksum_" + backup.version,
          database: "mock_database_checksum_" + backup.version,
        },
      };

      fs.writeFileSync(
        path.join(backupPath, "backup.json"),
        JSON.stringify(metadata, null, 2),
      );

      // Create mock backup files
      fs.writeFileSync(
        path.join(backupPath, "user-settings.json"),
        JSON.stringify({ version: backup.version, mockData: true }, null, 2),
      );

      fs.writeFileSync(
        path.join(backupPath, "sqlite.db"),
        `mock_database_content_${backup.version}`,
      );
    }
  },
});

const ensureAppIsRunning = async (po: PageObject) => {
  await po.page.waitForSelector("h1");
  const text = await po.page.$eval("h1", (el) => el.textContent);
  expect(text).toBe("Build your dream app");
};

test("backup is not created for first run", async ({ po }) => {
  await ensureAppIsRunning(po);

  expect(fs.existsSync(path.join(po.userDataDir, "backups"))).toEqual(false);
});

testWithLastVersion(
  "backup is created if version is upgraded",
  async ({ po }) => {
    await ensureAppIsRunning(po);

    const backups = fs.readdirSync(path.join(po.userDataDir, "backups"));
    expect(backups).toHaveLength(1);
    const backupDir = path.join(po.userDataDir, "backups", backups[0]);
    const backupMetadata = JSON.parse(
      fs.readFileSync(path.join(backupDir, "backup.json"), "utf8"),
    );

    expect(backupMetadata.version).toBeDefined();
    expect(backupMetadata.timestamp).toBeDefined();
    expect(backupMetadata.reason).toBe("upgrade_from_0.1.0");
    expect(backupMetadata.files.settings).toBe(true);
    expect(backupMetadata.files.database).toBe(true);
    expect(backupMetadata.checksums.settings).toBeDefined();
    expect(backupMetadata.checksums.database).toBeDefined();

    // Compare the backup files to the original files
    const backupSettings = fs.readFileSync(
      path.join(backupDir, "user-settings.json"),
      "utf8",
    );
    expect(backupSettings).toEqual(JSON.stringify(BACKUP_SETTINGS, null, 2));

    // For database, verify the backup file exists and has correct checksum
    const backupDbPath = path.join(backupDir, "sqlite.db");
    const originalDbPath = path.join(po.userDataDir, "sqlite.db");

    expect(fs.existsSync(backupDbPath)).toBe(true);
    expect(fs.existsSync(originalDbPath)).toBe(true);

    const backupChecksum = calculateChecksum(backupDbPath);
    // Verify backup metadata contains the correct checksum
    expect(backupMetadata.checksums.database).toBe(backupChecksum);
  },
);

testWithMultipleBackups(
  "backup cleanup deletes oldest backups when exceeding MAX_BACKUPS",
  async ({ po }) => {
    await ensureAppIsRunning(po);

    const backupsDir = path.join(po.userDataDir, "backups");
    const backups = fs.readdirSync(backupsDir);

    // Should have only 3 backups remaining (MAX_BACKUPS = 3)
    expect(backups).toHaveLength(3);

    const expectedRemainingBackups = [
      "*",
      // These are the two older backups
      "v1.0.4_2023-01-05T10-00-00-000Z_upgrade_from_1.0.3",
      "v1.0.3_2023-01-04T10-00-00-000Z_upgrade_from_1.0.2",
    ];

    // Check that the expected backups exist
    for (let backup of expectedRemainingBackups) {
      let expectedBackup = backup;
      if (backup === "*") {
        expectedBackup = backups[0];
        expect(expectedBackup.endsWith("_upgrade_from_0.1.0")).toEqual(true);
      } else {
        expect(backups).toContain(expectedBackup);
      }

      // Verify the backup directory and metadata still exist
      const backupPath = path.join(backupsDir, expectedBackup);
      expect(fs.existsSync(backupPath)).toBe(true);
      expect(fs.existsSync(path.join(backupPath, "backup.json"))).toBe(true);
      expect(fs.existsSync(path.join(backupPath, "user-settings.json"))).toBe(
        true,
      );

      // The first backup does NOT have a SQLite database because the backup
      // manager is run before the DB is initialized.
      expect(fs.existsSync(path.join(backupPath, "sqlite.db"))).toBe(
        backup !== "*",
      );
    }

    // The 2 oldest backups should have been deleted
    const deletedBackups = [
      "v1.0.0_2023-01-01T10-00-00-000Z_upgrade_from_0.9.0", // oldest
      "v1.0.1_2023-01-02T10-00-00-000Z_upgrade_from_1.0.0", // second oldest
      "v1.0.2_2023-01-03T10-00-00-000Z_upgrade_from_1.0.1", // third oldest
    ];

    for (const deletedBackup of deletedBackups) {
      expect(backups).not.toContain(deletedBackup);
      expect(fs.existsSync(path.join(backupsDir, deletedBackup))).toBe(false);
    }
  },
);

function calculateChecksum(filePath: string): string {
  const fileBuffer = fs.readFileSync(filePath);
  const hash = crypto.createHash("sha256");
  hash.update(fileBuffer);
  return hash.digest("hex");
}
