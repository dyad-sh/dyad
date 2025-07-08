import * as path from "path";
import * as fs from "fs/promises";
import { app } from "electron";
import * as crypto from "crypto";
import log from "electron-log";
import Database from "better-sqlite3";

const logger = log.scope("backup_manager");

const MAX_BACKUPS = 3;

interface BackupManagerOptions {
  settingsFile: string;
  dbFile: string;
}

interface BackupMetadata {
  version: string;
  timestamp: string;
  reason: string;
  files: {
    settings: boolean;
    database: boolean;
  };
  checksums: {
    settings: string | null;
    database: string | null;
  };
}

interface BackupInfo extends BackupMetadata {
  name: string;
}

export class BackupManager {
  private readonly maxBackups: number;
  private readonly settingsFilePath: string;
  private readonly dbFilePath: string;
  private userDataPath!: string;
  private backupBasePath!: string;

  constructor(options: BackupManagerOptions) {
    this.maxBackups = MAX_BACKUPS;
    this.settingsFilePath = options.settingsFile;
    this.dbFilePath = options.dbFile;
  }

  /**
   * Initialize backup system - call this on app ready
   */
  async initialize(): Promise<void> {
    logger.info("Initializing backup system...");

    // Set paths after app is ready
    this.userDataPath = app.getPath("userData");
    this.backupBasePath = path.join(this.userDataPath, "backups");

    logger.info(
      `Backup system paths - UserData: ${this.userDataPath}, Backups: ${this.backupBasePath}`,
    );

    // Check if this is a version upgrade
    const currentVersion = app.getVersion();
    const lastVersion = await this.getLastRunVersion();

    if (lastVersion === null) {
      logger.info("No previous version found, skipping backup");
      return;
    }

    if (lastVersion === currentVersion) {
      logger.info(
        `No version upgrade detected. Current version: ${currentVersion}`,
      );
      return;
    }

    // Ensure backup directory exists
    await fs.mkdir(this.backupBasePath, { recursive: true });
    logger.debug("Backup directory created/verified");

    logger.info(`Version upgrade detected: ${lastVersion} → ${currentVersion}`);
    await this.createBackup(`upgrade_from_${lastVersion}`);

    // Save current version
    await this.saveCurrentVersion(currentVersion);

    // Clean up old backups
    await this.cleanupOldBackups();
    logger.info("Backup system initialized successfully");
  }

  /**
   * Create a backup of settings and database
   */
  async createBackup(reason: string = "manual"): Promise<string> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const version = app.getVersion();
    const backupName = `v${version}_${timestamp}_${reason}`;
    const backupPath = path.join(this.backupBasePath, backupName);

    logger.info(`Creating backup: ${backupName} (reason: ${reason})`);

    try {
      // Create backup directory
      await fs.mkdir(backupPath, { recursive: true });
      logger.debug(`Backup directory created: ${backupPath}`);

      // Backup settings file
      const settingsBackupPath = path.join(
        backupPath,
        path.basename(this.settingsFilePath),
      );
      const settingsExists = await this.fileExists(this.settingsFilePath);

      if (settingsExists) {
        await fs.copyFile(this.settingsFilePath, settingsBackupPath);
        logger.info("Settings backed up successfully");
      } else {
        logger.debug("Settings file not found, skipping settings backup");
      }

      // Backup SQLite database
      const dbBackupPath = path.join(
        backupPath,
        path.basename(this.dbFilePath),
      );
      const dbExists = await this.fileExists(this.dbFilePath);

      if (dbExists) {
        await this.backupSQLiteDatabase(this.dbFilePath, dbBackupPath);
        logger.info("Database backed up successfully");
      } else {
        logger.debug("Database file not found, skipping database backup");
      }

      // Create backup metadata
      const metadata: BackupMetadata = {
        version,
        timestamp: new Date().toISOString(),
        reason,
        files: {
          settings: settingsExists,
          database: dbExists,
        },
        checksums: {
          settings: settingsExists
            ? await this.getFileChecksum(settingsBackupPath)
            : null,
          database: dbExists ? await this.getFileChecksum(dbBackupPath) : null,
        },
      };

      await fs.writeFile(
        path.join(backupPath, "backup.json"),
        JSON.stringify(metadata, null, 2),
      );

      logger.info(`Backup created successfully: ${backupName}`);
      return backupPath;
    } catch (error) {
      logger.error("Backup failed:", error);
      // Clean up failed backup
      try {
        await fs.rm(backupPath, { recursive: true, force: true });
        logger.debug("Failed backup directory cleaned up");
      } catch (cleanupError) {
        logger.error("Failed to clean up backup directory:", cleanupError);
      }
      throw new Error(`Backup creation failed: ${error}`);
    }
  }

  /**
   * List all available backups
   */
  async listBackups(): Promise<BackupInfo[]> {
    try {
      const entries = await fs.readdir(this.backupBasePath, {
        withFileTypes: true,
      });
      const backups: BackupInfo[] = [];

      logger.debug(`Found ${entries.length} entries in backup directory`);

      for (const entry of entries) {
        if (entry.isDirectory()) {
          const metadataPath = path.join(
            this.backupBasePath,
            entry.name,
            "backup.json",
          );

          try {
            const metadataContent = await fs.readFile(metadataPath, "utf8");
            const metadata: BackupMetadata = JSON.parse(metadataContent);
            backups.push({
              name: entry.name,
              ...metadata,
            });
          } catch (error) {
            logger.warn(`Invalid backup found: ${entry.name}`, error);
          }
        }
      }

      logger.info(`Found ${backups.length} valid backups`);

      // Sort by timestamp, newest first
      return backups.sort(
        (a, b) =>
          new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
      );
    } catch (error) {
      logger.error("Failed to list backups:", error);
      return [];
    }
  }

  /**
   * Clean up old backups, keeping only the most recent ones
   */
  async cleanupOldBackups(): Promise<void> {
    try {
      const backups = await this.listBackups();

      if (backups.length <= this.maxBackups) {
        logger.debug(
          `No cleanup needed - ${backups.length} backups (max: ${this.maxBackups})`,
        );
        return;
      }

      // Keep the newest backups
      const backupsToDelete = backups.slice(this.maxBackups);

      logger.info(
        `Cleaning up ${backupsToDelete.length} old backups (keeping ${this.maxBackups} most recent)`,
      );

      for (const backup of backupsToDelete) {
        const backupPath = path.join(this.backupBasePath, backup.name);
        await fs.rm(backupPath, { recursive: true, force: true });
        logger.debug(`Deleted old backup: ${backup.name}`);
      }

      logger.info("Old backup cleanup completed");
    } catch (error) {
      logger.error("Failed to clean up old backups:", error);
    }
  }

  /**
   * Delete a specific backup
   */
  async deleteBackup(backupName: string): Promise<void> {
    const backupPath = path.join(this.backupBasePath, backupName);

    logger.info(`Deleting backup: ${backupName}`);

    try {
      await fs.rm(backupPath, { recursive: true, force: true });
      logger.info(`Deleted backup: ${backupName}`);
    } catch (error) {
      logger.error(`Failed to delete backup ${backupName}:`, error);
      throw new Error(`Failed to delete backup: ${error}`);
    }
  }

  /**
   * Get backup size in bytes
   */
  async getBackupSize(backupName: string): Promise<number> {
    const backupPath = path.join(this.backupBasePath, backupName);
    logger.debug(`Calculating size for backup: ${backupName}`);

    const size = await this.getDirectorySize(backupPath);
    logger.debug(`Backup ${backupName} size: ${size} bytes`);

    return size;
  }

  /**
   * Backup SQLite database safely
   */
  private async backupSQLiteDatabase(
    sourcePath: string,
    destPath: string,
  ): Promise<void> {
    logger.debug(`Backing up SQLite database: ${sourcePath} → ${destPath}`);
    const sourceDb = new Database(sourcePath, {
      readonly: true,
      timeout: 10000,
    });

    try {
      // This is safe even if other connections are active
      await sourceDb.backup(destPath);
      logger.info("Database backup completed successfully");
    } catch (error) {
      logger.error("Database backup failed:", error);
      throw error;
    } finally {
      // Always close the temporary connection
      sourceDb.close();
    }
  }

  /**
   * Helper: Check if file exists
   */
  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Helper: Calculate file checksum
   */
  private async getFileChecksum(filePath: string): Promise<string | null> {
    try {
      const fileBuffer = await fs.readFile(filePath);
      const hash = crypto.createHash("sha256");
      hash.update(fileBuffer);
      const checksum = hash.digest("hex");
      logger.debug(
        `Checksum calculated for ${filePath}: ${checksum.substring(0, 8)}...`,
      );
      return checksum;
    } catch (error) {
      logger.error(`Failed to calculate checksum for ${filePath}:`, error);
      return null;
    }
  }

  /**
   * Helper: Get directory size recursively
   */
  private async getDirectorySize(dirPath: string): Promise<number> {
    let size = 0;

    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);

        if (entry.isDirectory()) {
          size += await this.getDirectorySize(fullPath);
        } else {
          const stats = await fs.stat(fullPath);
          size += stats.size;
        }
      }
    } catch (error) {
      logger.error(`Failed to calculate directory size for ${dirPath}:`, error);
    }

    return size;
  }

  /**
   * Helper: Get last run version
   */
  private async getLastRunVersion(): Promise<string | null> {
    try {
      const versionFile = path.join(this.userDataPath, ".last_version");
      const version = await fs.readFile(versionFile, "utf8");
      const trimmedVersion = version.trim();
      logger.debug(`Last run version retrieved: ${trimmedVersion}`);
      return trimmedVersion;
    } catch {
      logger.debug("No previous version file found");
      return null;
    }
  }

  /**
   * Helper: Save current version
   */
  private async saveCurrentVersion(version: string): Promise<void> {
    const versionFile = path.join(this.userDataPath, ".last_version");
    await fs.writeFile(versionFile, version, "utf8");
    logger.debug(`Current version saved: ${version}`);
  }
}
