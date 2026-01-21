import { createLoggedHandler } from "./safe_handle";
import log from "electron-log";
import { AppUpgrade } from "../ipc_types";
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

function getNextConfigPath(appPath: string): string | null {
  const nextConfigPathTs = path.join(appPath, "next.config.ts");
  const nextConfigPathMjs = path.join(appPath, "next.config.mjs");
  const nextConfigPathJs = path.join(appPath, "next.config.js");

  if (fs.existsSync(nextConfigPathTs)) {
    return nextConfigPathTs;
  } else if (fs.existsSync(nextConfigPathMjs)) {
    return nextConfigPathMjs;
  } else if (fs.existsSync(nextConfigPathJs)) {
    return nextConfigPathJs;
  }
  return null;
}

function isNextApp(appPath: string): boolean {
  return getNextConfigPath(appPath) !== null;
}

function isViteComponentTaggerUpgradeNeeded(appPath: string): boolean {
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

function isNextComponentTaggerUpgradeNeeded(appPath: string): boolean {
  const nextConfigPath = getNextConfigPath(appPath);
  if (!nextConfigPath) {
    return false;
  }

  try {
    const nextConfigContent = fs.readFileSync(nextConfigPath, "utf-8");
    return !nextConfigContent.includes(
      "@dyad-sh/nextjs-webpack-component-tagger",
    );
  } catch (e) {
    logger.error("Error reading next config", e);
    return false;
  }
}

function isComponentTaggerUpgradeNeeded(appPath: string): boolean {
  // Check Vite apps first
  if (isViteApp(appPath)) {
    return isViteComponentTaggerUpgradeNeeded(appPath);
  }
  // Check Next.js apps
  if (isNextApp(appPath)) {
    return isNextComponentTaggerUpgradeNeeded(appPath);
  }
  return false;
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

async function applyViteComponentTagger(appPath: string) {
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
  await installComponentTaggerDependency(
    appPath,
    "@dyad-sh/react-vite-component-tagger",
  );
}

async function applyNextComponentTagger(appPath: string) {
  const nextConfigPath = getNextConfigPath(appPath);
  if (!nextConfigPath) {
    throw new Error(
      "Could not find next.config.ts, next.config.mjs, or next.config.js",
    );
  }

  let content = await fs.promises.readFile(nextConfigPath, "utf-8");

  // Check if turbopack config already exists
  const hasTurbopackConfig =
    content.includes("turbopack:") || content.includes("turbopack :");

  if (hasTurbopackConfig) {
    // Need to add rules to existing turbopack config
    // This is more complex, so we'll just check if rules exist
    if (content.includes("rules:") || content.includes("rules :")) {
      throw new Error(
        "Turbopack rules already exist. Manual installation required. See https://dyad.sh/docs/upgrades/select-component",
      );
    }
    // Add rules to existing turbopack config
    content = content.replace(
      /turbopack\s*:\s*\{/,
      `turbopack: {
    rules: {
      "*.tsx": {
        loaders: ["@dyad-sh/nextjs-webpack-component-tagger"],
        as: "*.tsx",
      },
      "*.jsx": {
        loaders: ["@dyad-sh/nextjs-webpack-component-tagger"],
        as: "*.jsx",
      },
    },`,
    );
  } else {
    // Need to add turbopack config to nextConfig
    // Find the nextConfig object and add turbopack config
    const nextConfigMatch = content.match(
      /(const\s+nextConfig\s*[=:][^{]*\{|export\s+default\s*\{)/,
    );
    if (nextConfigMatch) {
      const insertPosition =
        (nextConfigMatch.index ?? 0) + nextConfigMatch[0].length;
      const turbopackConfig = `
  turbopack: {
    rules: {
      "*.tsx": {
        loaders: ["@dyad-sh/nextjs-webpack-component-tagger"],
        as: "*.tsx",
      },
      "*.jsx": {
        loaders: ["@dyad-sh/nextjs-webpack-component-tagger"],
        as: "*.jsx",
      },
    },
  },`;
      content =
        content.slice(0, insertPosition) +
        turbopackConfig +
        content.slice(insertPosition);
    } else {
      throw new Error(
        "Could not find nextConfig object in next.config file. Manual installation required.",
      );
    }
  }

  await fs.promises.writeFile(nextConfigPath, content);

  // Install the dependency
  await installComponentTaggerDependency(
    appPath,
    "@dyad-sh/nextjs-webpack-component-tagger",
  );
}

async function installComponentTaggerDependency(
  appPath: string,
  packageName: string,
) {
  await new Promise<void>((resolve, reject) => {
    logger.info(`Installing ${packageName} dependency`);
    const childProcess = spawn(
      `pnpm add -D ${packageName} || npm install --save-dev --legacy-peer-deps ${packageName}`,
      {
        cwd: appPath,
        shell: true,
        stdio: "pipe",
      },
    );

    childProcess.stdout?.on("data", (data) => logger.info(data.toString()));
    childProcess.stderr?.on("data", (data) => logger.error(data.toString()));

    childProcess.on("close", (code) => {
      if (code === 0) {
        logger.info(`${packageName} dependency installed successfully`);
        resolve();
      } else {
        logger.error(`Failed to install dependency, exit code ${code}`);
        reject(new Error("Failed to install dependency"));
      }
    });

    childProcess.on("error", (err) => {
      logger.error("Failed to spawn pnpm", err);
      reject(err);
    });
  });
}

async function applyComponentTagger(appPath: string) {
  if (isViteApp(appPath)) {
    await applyViteComponentTagger(appPath);
  } else if (isNextApp(appPath)) {
    await applyNextComponentTagger(appPath);
  } else {
    throw new Error(
      "Could not find vite.config or next.config. Manual installation required.",
    );
  }

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

export function registerAppUpgradeHandlers() {
  handle(
    "get-app-upgrades",
    async (_, { appId }: { appId: number }): Promise<AppUpgrade[]> => {
      const app = await getApp(appId);
      const appPath = getDyadAppPath(app.path);

      const upgradesWithStatus = availableUpgrades.map((upgrade) => {
        let isNeeded = false;
        if (upgrade.id === "component-tagger") {
          isNeeded = isComponentTaggerUpgradeNeeded(appPath);
        } else if (upgrade.id === "capacitor") {
          isNeeded = isCapacitorUpgradeNeeded(appPath);
        }
        return { ...upgrade, isNeeded };
      });

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
      } else {
        throw new Error(`Unknown upgrade id: ${upgradeId}`);
      }
    },
  );
}
