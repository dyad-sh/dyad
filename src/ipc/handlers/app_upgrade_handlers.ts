import { createLoggedHandler } from "./safe_handle";
import log from "electron-log";
import { AppUpgrade } from "@/ipc/types";
import { db } from "../../db";
import { apps } from "../../db/schema";
import { eq } from "drizzle-orm";
import { getDyadAppPath } from "../../paths/paths";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { gitAddAll, gitCommit } from "../utils/git_utils";
import { simpleSpawn } from "../utils/simpleSpawn";

export const logger = log.scope("app_upgrade_handlers");
const handle = createLoggedHandler(logger);

const availableUpgrades: Omit<AppUpgrade, "isNeeded">[] = [
  {
    id: "component-tagger",
    title: "Enable select component to edit",
    description:
      "Installs the Dyad component tagger Vite plugin and its dependencies.",
    manualUpgradeUrl: "https://dyad.sh/docs/upgrades/select-component",
  },
  {
    id: "capacitor",
    title: "Upgrade to hybrid mobile app with Capacitor",
    description:
      "Adds Capacitor to your app lets it run on iOS and Android in addition to the web.",
    manualUpgradeUrl: "https://dyad.sh/docs/guides/mobile-app#upgrade-your-app",
  },
  {
    id: "react-upgrade",
    title: "Upgrade React.js",
    description:
      "Upgrades your React app to the latest version using react2shell.",
    manualUpgradeUrl: "https://dyad.sh/docs/upgrades/react-upgrade",
  },
];

async function getApp(appId: number) {
  const app = await db.query.apps.findFirst({
    where: eq(apps.id, appId),
  });
  if (!app) {
    throw new Error(`App with id ${appId} not found`);
  }
  return app;
}

function isViteApp(appPath: string): boolean {
  const viteConfigPathJs = path.join(appPath, "vite.config.js");
  const viteConfigPathTs = path.join(appPath, "vite.config.ts");

  return fs.existsSync(viteConfigPathTs) || fs.existsSync(viteConfigPathJs);
}

function isComponentTaggerUpgradeNeeded(appPath: string): boolean {
  const viteConfigPathJs = path.join(appPath, "vite.config.js");
  const viteConfigPathTs = path.join(appPath, "vite.config.ts");

  let viteConfigPath;
  if (fs.existsSync(viteConfigPathTs)) {
    viteConfigPath = viteConfigPathTs;
  } else if (fs.existsSync(viteConfigPathJs)) {
    viteConfigPath = viteConfigPathJs;
  } else {
    return false;
  }

  try {
    const viteConfigContent = fs.readFileSync(viteConfigPath, "utf-8");
    return !viteConfigContent.includes("@dyad-sh/react-vite-component-tagger");
  } catch (e) {
    logger.error("Error reading vite config", e);
    return false;
  }
}

function isCapacitorUpgradeNeeded(appPath: string): boolean {
  // Check if it's a Vite app first
  if (!isViteApp(appPath)) {
    return false;
  }

  // Check if Capacitor is already installed
  const capacitorConfigJs = path.join(appPath, "capacitor.config.js");
  const capacitorConfigTs = path.join(appPath, "capacitor.config.ts");
  const capacitorConfigJson = path.join(appPath, "capacitor.config.json");

  // If any Capacitor config exists, the upgrade is not needed
  if (
    fs.existsSync(capacitorConfigJs) ||
    fs.existsSync(capacitorConfigTs) ||
    fs.existsSync(capacitorConfigJson)
  ) {
    return false;
  }

  return true;
}

async function getLatestReactVersion(majorVersion: number): Promise<string | null> {
  try {
    const response = await fetch("https://registry.npmjs.org/react");
    if (!response.ok) {
      logger.error(`Failed to fetch React versions from NPM: ${response.status}`);
      return null;
    }
    const data = await response.json();
    const versions = Object.keys(data.versions);

    // Find the latest version for the given major version
    const matchingVersions = versions.filter((v) => {
      const major = parseInt(v.split(".")[0], 10);
      return major === majorVersion && !v.includes("-"); // Exclude pre-release versions
    });

    if (matchingVersions.length === 0) {
      return null;
    }

    // Sort versions and get the latest
    matchingVersions.sort((a, b) => {
      const partsA = a.split(".").map(Number);
      const partsB = b.split(".").map(Number);
      for (let i = 0; i < 3; i++) {
        if (partsA[i] !== partsB[i]) {
          return partsA[i] - partsB[i];
        }
      }
      return 0;
    });

    return matchingVersions[matchingVersions.length - 1];
  } catch (e) {
    logger.error("Error fetching React versions from NPM", e);
    return null;
  }
}

async function isReactUpgradeNeeded(appPath: string): Promise<boolean> {
  // Check if it's a Vite app first
  if (!isViteApp(appPath)) {
    return false;
  }

  const packageJsonPath = path.join(appPath, "package.json");
  if (!fs.existsSync(packageJsonPath)) {
    return false;
  }

  try {
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
    const reactVersion =
      packageJson.dependencies?.react || packageJson.devDependencies?.react;

    if (!reactVersion) {
      return false;
    }

    // Remove any leading ^ or ~ from version string
    const cleanVersion = reactVersion.replace(/^[\^~]/, "");
    const versionParts = cleanVersion.split(".");
    const majorVersion = parseInt(versionParts[0], 10);

    if (isNaN(majorVersion)) {
      return false;
    }

    // Only check for React 18 and 19
    if (majorVersion !== 18 && majorVersion !== 19) {
      return false;
    }

    // Fetch the latest version for this major version from NPM
    const latestVersion = await getLatestReactVersion(majorVersion);
    if (!latestVersion) {
      // If we can't fetch from NPM, don't show the upgrade
      return false;
    }

    // Compare versions - upgrade needed if not on the latest
    return cleanVersion !== latestVersion;
  } catch (e) {
    logger.error("Error checking React version", e);
    return false;
  }
}

async function applyComponentTagger(appPath: string) {
  const viteConfigPathJs = path.join(appPath, "vite.config.js");
  const viteConfigPathTs = path.join(appPath, "vite.config.ts");

  let viteConfigPath;
  if (fs.existsSync(viteConfigPathTs)) {
    viteConfigPath = viteConfigPathTs;
  } else if (fs.existsSync(viteConfigPathJs)) {
    viteConfigPath = viteConfigPathJs;
  } else {
    throw new Error("Could not find vite.config.js or vite.config.ts");
  }

  let content = await fs.promises.readFile(viteConfigPath, "utf-8");

  // Add import statement if not present
  if (
    !content.includes(
      "import dyadComponentTagger from '@dyad-sh/react-vite-component-tagger';",
    )
  ) {
    // Add it after the last import statement
    const lines = content.split("\n");
    let lastImportIndex = -1;
    for (let i = lines.length - 1; i >= 0; i--) {
      if (lines[i].startsWith("import ")) {
        lastImportIndex = i;
        break;
      }
    }
    lines.splice(
      lastImportIndex + 1,
      0,
      "import dyadComponentTagger from '@dyad-sh/react-vite-component-tagger';",
    );
    content = lines.join("\n");
  }

  // Add plugin to plugins array
  if (content.includes("plugins: [")) {
    if (!content.includes("dyadComponentTagger()")) {
      content = content.replace(
        "plugins: [",
        "plugins: [dyadComponentTagger(), ",
      );
    }
  } else {
    throw new Error(
      "Could not find `plugins: [` in vite.config.ts. Manual installation required.",
    );
  }

  await fs.promises.writeFile(viteConfigPath, content);

  // Install the dependency
  await new Promise<void>((resolve, reject) => {
    logger.info("Installing component-tagger dependency");
    const process = spawn(
      "pnpm add -D @dyad-sh/react-vite-component-tagger || npm install --save-dev --legacy-peer-deps @dyad-sh/react-vite-component-tagger",
      {
        cwd: appPath,
        shell: true,
        stdio: "pipe",
      },
    );

    process.stdout?.on("data", (data) => logger.info(data.toString()));
    process.stderr?.on("data", (data) => logger.error(data.toString()));

    process.on("close", (code) => {
      if (code === 0) {
        logger.info("component-tagger dependency installed successfully");
        resolve();
      } else {
        logger.error(`Failed to install dependency, exit code ${code}`);
        reject(new Error("Failed to install dependency"));
      }
    });

    process.on("error", (err) => {
      logger.error("Failed to spawn pnpm", err);
      reject(err);
    });
  });

  // Commit changes
  try {
    logger.info("Staging and committing changes");
    await gitAddAll({ path: appPath });
    await gitCommit({
      path: appPath,
      message: "[dyad] add Dyad component tagger",
    });
    logger.info("Successfully committed changes");
  } catch (err) {
    logger.warn(
      `Failed to commit changes. This may happen if the project is not in a git repository, or if there are no changes to commit.`,
      err,
    );
  }
}

async function applyCapacitor({
  appName,
  appPath,
}: {
  appName: string;
  appPath: string;
}) {
  // Install Capacitor dependencies
  await simpleSpawn({
    command:
      "pnpm add @capacitor/core@7.4.4 @capacitor/cli@7.4.4 @capacitor/ios@7.4.4 @capacitor/android@7.4.4 || npm install @capacitor/core@7.4.4 @capacitor/cli@7.4.4 @capacitor/ios@7.4.4 @capacitor/android@7.4.4 --legacy-peer-deps",
    cwd: appPath,
    successMessage: "Capacitor dependencies installed successfully",
    errorPrefix: "Failed to install Capacitor dependencies",
  });

  // Initialize Capacitor
  await simpleSpawn({
    command: `npx cap init "${appName}" "com.example.${appName.toLowerCase().replace(/[^a-z0-9]/g, "")}" --web-dir=dist`,
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
      message: "[dyad] add Capacitor for mobile app support",
    });
    logger.info("Successfully committed Capacitor changes");
  } catch (err) {
    logger.warn(
      `Failed to commit changes. This may happen if the project is not in a git repository, or if there are no changes to commit.`,
      err,
    );
    throw new Error(
      "Failed to commit Capacitor changes. Please commit them manually. Error: " +
        err,
    );
  }
}

async function applyReactUpgrade(appPath: string) {
  // Run react2shell to upgrade React
  await simpleSpawn({
    command: "npx react2shell",
    cwd: appPath,
    successMessage: "React upgrade completed successfully",
    errorPrefix: "Failed to upgrade React",
  });

  // Commit changes
  try {
    logger.info("Staging and committing React upgrade changes");
    await gitAddAll({ path: appPath });
    await gitCommit({
      path: appPath,
      message: "[dyad] upgrade React.js",
    });
    logger.info("Successfully committed React upgrade changes");
  } catch (err) {
    logger.warn(
      `Failed to commit changes. This may happen if the project is not in a git repository, or if there are no changes to commit.`,
      err,
    );
  }
}

export function registerAppUpgradeHandlers() {
  handle(
    "get-app-upgrades",
    async (_, { appId }: { appId: number }): Promise<AppUpgrade[]> => {
      const app = await getApp(appId);
      const appPath = getDyadAppPath(app.path);

      const upgradesWithStatus = await Promise.all(
        availableUpgrades.map(async (upgrade) => {
          let isNeeded = false;
          if (upgrade.id === "component-tagger") {
            isNeeded = isComponentTaggerUpgradeNeeded(appPath);
          } else if (upgrade.id === "capacitor") {
            isNeeded = isCapacitorUpgradeNeeded(appPath);
          } else if (upgrade.id === "react-upgrade") {
            isNeeded = await isReactUpgradeNeeded(appPath);
          }
          return { ...upgrade, isNeeded };
        })
      );

      return upgradesWithStatus;
    },
  );

  handle(
    "execute-app-upgrade",
    async (_, { appId, upgradeId }: { appId: number; upgradeId: string }) => {
      if (!upgradeId) {
        throw new Error("upgradeId is required");
      }

      const app = await getApp(appId);
      const appPath = getDyadAppPath(app.path);

      if (upgradeId === "component-tagger") {
        await applyComponentTagger(appPath);
      } else if (upgradeId === "capacitor") {
        await applyCapacitor({ appName: app.name, appPath });
      } else if (upgradeId === "react-upgrade") {
        await applyReactUpgrade(appPath);
      } else {
        throw new Error(`Unknown upgrade id: ${upgradeId}`);
      }
    },
  );
}
