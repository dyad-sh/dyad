import log from "electron-log";
import { db } from "../../db";
import { apps } from "../../db/schema";
import { eq } from "drizzle-orm";
import { getDyadAppPath } from "../../paths/paths";
import fs from "node:fs";
import path from "node:path";
import { simpleSpawn } from "../utils/simpleSpawn";
import { IS_TEST_BUILD } from "../utils/test_utils";
import { createTypedHandler } from "./base";
import { capacitorContracts } from "../types/capacitor";

const logger = log.scope("capacitor_handlers");

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
  createTypedHandler(capacitorContracts.isCapacitor, async (_, params) => {
    const app = await getApp(params.appId);
    const appPath = getDyadAppPath(app.path);

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
  });

  createTypedHandler(capacitorContracts.syncCapacitor, async (_, params) => {
    const app = await getApp(params.appId);
    const appPath = getDyadAppPath(app.path);

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
  });

  createTypedHandler(capacitorContracts.openIos, async (_, params) => {
    const app = await getApp(params.appId);
    const appPath = getDyadAppPath(app.path);

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

  createTypedHandler(capacitorContracts.openAndroid, async (_, params) => {
    const app = await getApp(params.appId);
    const appPath = getDyadAppPath(app.path);

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
  });
}
