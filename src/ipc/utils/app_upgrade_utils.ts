import log from "electron-log";
import fs from "node:fs";
import path from "node:path";
import { gitAddAll, gitCommit } from "./git_utils";
import { simpleSpawn } from "./simpleSpawn";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import {
  CommandExecutionError,
  isPnpmIgnoredBuildsError,
  parsePnpmIgnoredBuildsFromOutput,
  PNPM_PM_ON_FAIL_IGNORE_ARG,
} from "./socket_firewall";
import {
  recordAndReportDeniedPnpmBuilds,
  resolvePnpmIgnoredBuilds,
} from "./pnpm_denied_builds";
import { isDockerRuntimeActive } from "@/ipc/services/docker_runtime/runtime_mode";
import {
  resolveAppIdForPath,
  runPackageManagerCommandInGuest,
} from "./docker_package_manager";

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
  /** Needed to install in Docker mode; looked up from the path when omitted. */
  appId?: number;
};

// Unlike the app-runtime self-heal, this does NOT remove node_modules before
// the retry. That is safe: pnpm re-evaluates previously ignored builds
// against allowBuilds on every install — an explicit `pkg: false` entry
// silences ERR_PNPM_IGNORED_BUILDS even on an "Already up to date" fast-path
// run (verified against pnpm 11.10) — and these upgrade callers are
// add/install commands whose retry re-links real work anyway.
export async function selfHealDeniedPnpmBuildsFromError({
  appPath,
  error,
  source,
  installedInGuest = false,
}: {
  appPath: string;
  error: unknown;
  source: "self-heal";
  /**
   * The install ran in the Docker guest, so node_modules/.modules.yaml is in
   * its volume and any host copy is a stale Local-mode install.
   */
  installedInGuest?: boolean;
}): Promise<boolean> {
  if (!isPnpmIgnoredBuildsError(error)) {
    return false;
  }

  const errorOutput = error instanceof Error ? error.message : String(error);
  const ignoredBuilds = installedInGuest
    ? parsePnpmIgnoredBuildsFromOutput(errorOutput)
    : await resolvePnpmIgnoredBuilds(appPath, errorOutput);
  const { deniedBuilds } = await recordAndReportDeniedPnpmBuilds({
    appPath,
    ignoredBuilds,
    source,
  });
  return deniedBuilds.length > 0;
}

// Only Dyad's own fixed install commands are routed to the guest; they are
// plain words, so splitting on whitespace is their exact argv.
const STATIC_COMMAND_PATTERN = /^[A-Za-z0-9@._=:/ -]+$/;

function splitStaticCommand(command: string): {
  command: string;
  args: string[];
} {
  if (!STATIC_COMMAND_PATTERN.test(command)) {
    throw new DyadError(
      `Cannot run '${command}' in the Docker runtime: it is not a plain argument list`,
      DyadErrorKind.Internal,
    );
  }
  const [executable, ...args] = command.trim().split(/\s+/);
  return { command: executable, args };
}

/**
 * {@link simpleSpawn} for Docker mode: runs the package-manager command in
 * the guest (it executes dependency lifecycle scripts) and reports failures in
 * the same `STDOUT`/`STDERR` shape.
 */
async function guestSimpleSpawn({
  appId,
  command,
  cwd,
  errorPrefix,
}: {
  appId: number;
  command: string;
  cwd: string;
  errorPrefix: string;
}): Promise<void> {
  try {
    await runPackageManagerCommandInGuest({
      appId,
      appPath: cwd,
      invocation: splitStaticCommand(command),
    });
  } catch (error) {
    if (error instanceof CommandExecutionError) {
      throw new DyadError(
        `${errorPrefix}: ${error.message}\n\nSTDOUT:\n${error.stdout}\n\nSTDERR:\n${error.stderr}`,
        DyadErrorKind.External,
      );
    }
    throw error;
  }
}

/**
 * Runs one of Dyad's package-manager commands for an app upgrade: on the
 * host, or in the guest in Docker mode (`appId` is looked up from `cwd` when
 * omitted). A pnpm ERR_PNPM_IGNORED_BUILDS failure is recorded as denials and
 * retried once.
 */
export async function simpleSpawnWithDeniedPnpmBuildSelfHeal({
  command,
  cwd,
  successMessage,
  errorPrefix,
  appId,
}: {
  command: string;
  cwd: string;
  successMessage: string;
  errorPrefix: string;
  appId?: number;
}): Promise<void> {
  const guestAppId = isDockerRuntimeActive()
    ? (appId ?? (await resolveAppIdForPath(cwd)))
    : undefined;
  const spawn = async () => {
    if (guestAppId === undefined) {
      await simpleSpawn({ command, cwd, successMessage, errorPrefix });
      return;
    }
    await guestSimpleSpawn({ appId: guestAppId, command, cwd, errorPrefix });
    logger.info(successMessage);
  };

  try {
    await spawn();
  } catch (error) {
    const healed = await selfHealDeniedPnpmBuildsFromError({
      appPath: cwd,
      error,
      source: "self-heal",
      installedInGuest: guestAppId !== undefined,
    });
    if (!healed) {
      throw error;
    }

    await spawn();
  }
}

export async function applyComponentTagger(
  appPath: string,
  options: ApplyComponentTaggerOptions = {},
) {
  const { installDependencies = true, appId } = options;
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
      await simpleSpawnWithDeniedPnpmBuildSelfHeal({
        command: `pnpm ${PNPM_PM_ON_FAIL_IGNORE_ARG} add --ignore-workspace-root-check -D @dyad-sh/react-vite-component-tagger`,
        cwd: appPath,
        successMessage:
          "component-tagger dependency installed successfully with pnpm",
        errorPrefix: "Failed to install dependency via pnpm",
        appId,
      });
    } catch (pnpmErr) {
      // Docker mode installs only with the guest's pnpm (as its dev server
      // does): an npm install would leave an npm-shaped node_modules the next
      // pnpm install purges, and there is no host fallback.
      const dockerMode = isDockerRuntimeActive();
      if (!dockerMode) {
        logger.info("pnpm install failed, falling back to npm", pnpmErr);
      }
      try {
        if (dockerMode) {
          throw pnpmErr;
        }
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
        if (dockerMode) {
          throw npmErr;
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
      message: "add Dyad component tagger",
    });
    logger.info("Successfully committed component tagger modifications");
  } catch (err) {
    logger.warn(
      `Failed to commit changes. This may happen if the project is not in a git repository, or if there are no changes to commit.`,
      err,
    );
  }
}
