import log from "electron-log";
import fs from "node:fs";
import path from "node:path";
import { gitAddAll, gitCommit } from "./git_utils";
import { simpleSpawn } from "./simpleSpawn";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { PNPM_PM_ON_FAIL_IGNORE_ARG } from "./socket_firewall";

export const logger = log.scope("app_upgrade_utils");

const COMPONENT_TAGGER_VERSION = "^0.9.0";

function findViteConfigPath(appPath: string): string | null {
  const viteConfigPathTs = path.join(appPath, "vite.config.ts");
  const viteConfigPathJs = path.join(appPath, "vite.config.js");

  if (fs.existsSync(viteConfigPathTs)) {
    return viteConfigPathTs;
  } else if (fs.existsSync(viteConfigPathJs)) {
    return viteConfigPathJs;
  }
  return null;
}

export function isComponentTaggerUpgradeNeeded(appPath: string): boolean {
  const viteConfigPath = findViteConfigPath(appPath);
  if (!viteConfigPath) {
    return false;
  }

  try {
    const viteConfigContent = fs.readFileSync(viteConfigPath, "utf-8");
    // Component tagger is React-specific, so only offer it for Vite configs
    // that already use the React plugin.
    if (!viteConfigContent.includes("plugin-react")) {
      return false;
    }
    return !viteConfigContent.includes("@dyad-sh/react-vite-component-tagger");
  } catch (e) {
    logger.error("Error reading vite config", e);
    return false;
  }
}

type ApplyComponentTaggerOptions = {
  installDependencies?: boolean;
};

export async function applyComponentTagger(
  appPath: string,
  options: ApplyComponentTaggerOptions = {},
) {
  const { installDependencies = true } = options;
  const packageJsonPath = path.join(appPath, "package.json");
  const viteConfigPath = findViteConfigPath(appPath);

  if (!viteConfigPath) {
    throw new DyadError(
      "Could not find vite.config.js or vite.config.ts",
      DyadErrorKind.External,
    );
  }

  const originalViteContent = await fs.promises.readFile(
    viteConfigPath,
    "utf-8",
  );
  let content = originalViteContent;

  if (
    !content.includes(
      "import dyadComponentTagger from '@dyad-sh/react-vite-component-tagger';",
    )
  ) {
    const lines = content.split("\n");
    let lastImportIndex = -1;
    for (let i = lines.length - 1; i >= 0; i--) {
      if (lines[i].trimStart().startsWith("import ")) {
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

  // Search for `defineConfig(` (with opening paren) to match the actual call,
  // not the `import { defineConfig } from 'vite'` import statement.
  const defineConfigIdx = content.indexOf("defineConfig(");
  const searchIndex = defineConfigIdx !== -1 ? defineConfigIdx : 0;

  let match = content.slice(searchIndex).match(/plugins\s*:\s*\[/);
  let pluginsIdx = -1;
  let matchStr = "";

  if (match && match.index !== undefined) {
    pluginsIdx = searchIndex + match.index;
    matchStr = match[0];
  } else if (searchIndex > 0) {
    // Fallback to searching the entire file
    match = content.match(/plugins\s*:\s*\[/);
    if (match && match.index !== undefined) {
      pluginsIdx = match.index;
      matchStr = match[0];
    }
  }

  if (pluginsIdx !== -1) {
    if (!content.includes("dyadComponentTagger()")) {
      const bracketIdx = pluginsIdx + matchStr.indexOf("[");
      content =
        content.slice(0, bracketIdx) +
        "[dyadComponentTagger(), " +
        content.slice(bracketIdx + 1);
    }
  } else {
    throw new DyadError(
      `Could not find 'plugins: [' in ${path.basename(viteConfigPath)}. Manual installation required.`,
      DyadErrorKind.External,
    );
  }

  await fs.promises.writeFile(viteConfigPath, content);

  if (installDependencies) {
    try {
      await simpleSpawn({
        command: `pnpm ${PNPM_PM_ON_FAIL_IGNORE_ARG} add --ignore-workspace-root-check -D @dyad-sh/react-vite-component-tagger`,
        cwd: appPath,
        successMessage:
          "component-tagger dependency installed successfully with pnpm",
        errorPrefix: "Failed to install dependency via pnpm",
      });
    } catch (pnpmErr) {
      logger.info("pnpm install failed, falling back to npm", pnpmErr);
      try {
        await simpleSpawn({
          command:
            "npm install --save-dev --legacy-peer-deps @dyad-sh/react-vite-component-tagger",
          cwd: appPath,
          successMessage:
            "component-tagger dependency installed successfully with npm",
          errorPrefix: "Failed to install dependency via npm",
        });
      } catch (npmErr) {
        logger.warn(
          "Failed to install component tagger with both pnpm and npm. User may need to run install manually.",
          npmErr,
        );
        try {
          await fs.promises.writeFile(viteConfigPath, originalViteContent);
        } catch (rollbackErr) {
          logger.error("Failed to rollback vite config changes", rollbackErr);
        }
        throw new DyadError(
          "Failed to install component tagger dependency",
          DyadErrorKind.Internal,
        );
      }
    }
  } else {
    try {
      const packageJson = JSON.parse(
        await fs.promises.readFile(packageJsonPath, "utf-8"),
      );
      packageJson.devDependencies ??= {};
      packageJson.devDependencies["@dyad-sh/react-vite-component-tagger"] =
        COMPONENT_TAGGER_VERSION;
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
      logger.warn(
        "Failed to update package.json for component tagger, rolling back vite config changes",
        err,
      );
      // Rollback vite config changes
      try {
        await fs.promises.writeFile(viteConfigPath, originalViteContent);
      } catch (rollbackErr) {
        logger.error("Failed to rollback vite config changes", rollbackErr);
      }
      throw new DyadError(
        `Failed to update package.json for component tagger: ${err instanceof Error ? err.message : String(err)}`,
        DyadErrorKind.Internal,
      );
    }
    logger.info("Skipping dependency install for component tagger");
  }

  try {
    logger.info("Staging and committing vite config and package.json changes");
    await gitAddAll({ path: appPath });
    await gitCommit({
      path: appPath,
      message: "[dyad] add Dyad component tagger",
    });
    logger.info("Successfully committed component tagger modifications");
  } catch (err) {
    logger.warn(
      `Failed to commit changes. This may happen if the project is not in a git repository, or if there are no changes to commit.`,
      err,
    );
  }
}
