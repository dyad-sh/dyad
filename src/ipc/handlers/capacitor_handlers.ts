import { createLoggedHandler } from "./safe_handle";
import log from "electron-log";
import { db } from "../../db";
import { apps } from "../../db/schema";
import { eq } from "drizzle-orm";
import { getJoyAppPath } from "../../paths/paths";
import fs from "node:fs";
import path from "node:path";
import { simpleSpawn } from "../utils/simpleSpawn";
import { gitAddAll, gitCommit } from "../utils/git_utils";
import { IS_TEST_BUILD } from "../utils/test_utils";

const logger = log.scope("capacitor_handlers");
const handle = createLoggedHandler(logger);

async function getApp(appId: number) {
  const app = await db.query.apps.findFirst({
    where: eq(apps.id, appId),
  });
  if (!app) {
    throw new Error(`App with id ${appId} not found`);
  }
  return app;
}

function isCapacitorInstalled(appPath: string): boolean {
  const capacitorConfigJs = path.join(appPath, "capacitor.config.js");
  const capacitorConfigTs = path.join(appPath, "capacitor.config.ts");
  const capacitorConfigJson = path.join(appPath, "capacitor.config.json");

  return (
    fs.existsSync(capacitorConfigJs) ||
    fs.existsSync(capacitorConfigTs) ||
    fs.existsSync(capacitorConfigJson)
  );
}

export function registerCapacitorHandlers() {
  handle(
    "is-capacitor",
    async (_, { appId }: { appId: number }): Promise<boolean> => {
      const app = await getApp(appId);
      const appPath = getJoyAppPath(app.path);

      // check for the required Node.js version before running any commands
      const currentNodeVersion = process.version;
      const majorVersion = parseInt(
        currentNodeVersion.slice(1).split(".")[0],
        10,
      );

      if (majorVersion < 20) {
        // version is too old? stop and throw a clear error
        throw new Error(
          `Capacitor requires Node.js v20 or higher, but you are using ${currentNodeVersion}. Please upgrade your Node.js and try again.`,
        );
      }
      return isCapacitorInstalled(appPath);
    },
  );

  handle(
    "sync-capacitor",
    async (_, { appId }: { appId: number }): Promise<void> => {
      const app = await getApp(appId);
      const appPath = getJoyAppPath(app.path);

      if (!isCapacitorInstalled(appPath)) {
        throw new Error("Capacitor is not installed in this app");
      }

      await simpleSpawn({
        command: "npm run build",
        cwd: appPath,
        successMessage: "App built successfully",
        errorPrefix: "Failed to build app",
      });

      await simpleSpawn({
        command: "npx cap sync",
        cwd: appPath,
        successMessage: "Capacitor sync completed successfully",
        errorPrefix: "Failed to sync Capacitor",
        env: {
          ...process.env,
          LANG: "en_US.UTF-8",
        },
      });
    },
  );

  handle("open-ios", async (_, { appId }: { appId: number }): Promise<void> => {
    const app = await getApp(appId);
    const appPath = getJoyAppPath(app.path);

    if (!isCapacitorInstalled(appPath)) {
      throw new Error("Capacitor is not installed in this app");
    }

    if (IS_TEST_BUILD) {
      // In test mode, just log the action instead of actually opening Xcode
      logger.info("Test mode: Simulating opening iOS project in Xcode");
      return;
    }

    await simpleSpawn({
      command: "npx cap open ios",
      cwd: appPath,
      successMessage: "iOS project opened successfully",
      errorPrefix: "Failed to open iOS project",
    });
  });

  handle(
    "open-android",
    async (_, { appId }: { appId: number }): Promise<void> => {
      const app = await getApp(appId);
      const appPath = getJoyAppPath(app.path);

      if (!isCapacitorInstalled(appPath)) {
        throw new Error("Capacitor is not installed in this app");
      }

      if (IS_TEST_BUILD) {
        // In test mode, just log the action instead of actually opening Android Studio
        logger.info(
          "Test mode: Simulating opening Android project in Android Studio",
        );
        return;
      }

      await simpleSpawn({
        command: "npx cap open android",
        cwd: appPath,
        successMessage: "Android project opened successfully",
        errorPrefix: "Failed to open Android project",
      });
    },
  );

  handle(
    "capacitor:init",
    async (_, { appId }: { appId: number }): Promise<void> => {
      const app = await getApp(appId);
      const appPath = getJoyAppPath(app.path);

      if (isCapacitorInstalled(appPath)) {
        throw new Error("Capacitor is already installed in this app");
      }

      // Install Capacitor dependencies
      await simpleSpawn({
        command:
          "pnpm add @capacitor/core@7.4.4 @capacitor/cli@7.4.4 @capacitor/ios@7.4.4 @capacitor/android@7.4.4 || npm install @capacitor/core@7.4.4 @capacitor/cli@7.4.4 @capacitor/ios@7.4.4 @capacitor/android@7.4.4 --legacy-peer-deps",
        cwd: appPath,
        successMessage: "Capacitor dependencies installed successfully",
        errorPrefix: "Failed to install Capacitor dependencies",
      });

      // Initialize Capacitor
      const safeName = app.name.toLowerCase().replace(/[^a-z0-9]/g, "");
      await simpleSpawn({
        command: `npx cap init "${app.name}" "com.example.${safeName}" --web-dir=dist`,
        cwd: appPath,
        successMessage: "Capacitor initialized successfully",
        errorPrefix: "Failed to initialize Capacitor",
      });

      // Add iOS and Android platforms
      await simpleSpawn({
        command: "npx cap add ios && npx cap add android",
        cwd: appPath,
        successMessage: "iOS and Android platforms added successfully",
        errorPrefix: "Failed to add iOS and Android platforms",
      });

      // Commit changes
      try {
        logger.info("Staging and committing Capacitor changes");
        await gitAddAll({ path: appPath });
        await gitCommit({
          path: appPath,
          message: "[joy] add Capacitor for mobile app support",
        });
        logger.info("Successfully committed Capacitor changes");
      } catch (err) {
        logger.warn(
          "Failed to commit Capacitor changes. This may happen if the project is not in a git repository.",
          err,
        );
      }
    },
  );
}
