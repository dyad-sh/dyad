import log from "electron-log";
import fs from "node:fs";
import path from "node:path";
import { gitAddAll, gitCommit } from "./git_utils";
import { simpleSpawn } from "./simpleSpawn";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { getPackageManagerCommandEnv } from "./socket_firewall";

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
  const packageJsonPath = path.join(appPath, "package.json");

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

  // Update package.json immediately so the dependency is visible even if the
  // package manager install is slow or unavailable in the import environment.
  try {
    const packageJson = JSON.parse(
      await fs.promises.readFile(packageJsonPath, "utf-8"),
    );
    packageJson.devDependencies ??= {};
    packageJson.devDependencies["@dyad-sh/react-vite-component-tagger"] =
      "^0.9.0";
    if (packageJson.dependencies?.["@dyad-sh/react-vite-component-tagger"]) {
      delete packageJson.dependencies["@dyad-sh/react-vite-component-tagger"];
      if (Object.keys(packageJson.dependencies).length === 0) {
        delete packageJson.dependencies;
      }
    }
    await fs.promises.writeFile(
      packageJsonPath,
      `${JSON.stringify(packageJson, null, 2)}\n`,
    );
  } catch (err) {
    logger.warn("Failed to update package.json for component tagger", err);
  }

  // Keep install off the import's critical path
  void simpleSpawn({
    command:
      "pnpm add --ignore-workspace-root-check -D @dyad-sh/react-vite-component-tagger || npm install --save-dev --legacy-peer-deps @dyad-sh/react-vite-component-tagger",
    cwd: appPath,
    env: getPackageManagerCommandEnv() as Record<string, string>,
    successMessage: "component-tagger dependency installed successfully",
    errorPrefix: "Failed to install dependency via pnpm",
  }).catch((err) => logger.warn("Component tagger install failed", err));

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
