import log from "electron-log";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { gitAddAll, gitCommit } from "./git_utils";
import { simpleSpawn } from "./simpleSpawn";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";

export const logger = log.scope("app_upgrade_utils");

export function isViteApp(appPath: string): boolean {
  const viteConfigPathJs = path.join(appPath, "vite.config.js");
  const viteConfigPathTs = path.join(appPath, "vite.config.ts");

  return fs.existsSync(viteConfigPathTs) || fs.existsSync(viteConfigPathJs);
}

export function isComponentTaggerUpgradeNeeded(appPath: string): boolean {
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

export async function applyComponentTagger(appPath: string) {
  const viteConfigPathJs = path.join(appPath, "vite.config.js");
  const viteConfigPathTs = path.join(appPath, "vite.config.ts");

  let viteConfigPath;
  if (fs.existsSync(viteConfigPathTs)) {
    viteConfigPath = viteConfigPathTs;
  } else if (fs.existsSync(viteConfigPathJs)) {
    viteConfigPath = viteConfigPathJs;
  } else {
    throw new DyadError(
      "Could not find vite.config.js or vite.config.ts",
      DyadErrorKind.External,
    );
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
      `Could not find 'plugins: [' in ${path.basename(viteConfigPath)}. Manual installation required.`,
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
