import * as fs from "node:fs";
import * as path from "node:path";
import { eq } from "drizzle-orm";
import log from "electron-log";
import { db } from "../../db";
import { apps } from "../../db/schema";
import { readSettings, writeSettings } from "../../main/settings";
import { getDyadAppPath } from "@/paths/paths";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { deedPageContracts } from "../types/deedpage";
import type {
  DeedPageSite,
  PublishToDeedPageParams,
  PublishToDeedPageResult,
} from "../types/deedpage";
import { createTypedHandler } from "./base";
import { createAppOperationHandler } from "../utils/app_mutation_lock";
import { readAppResource } from "../services/app_operation_coordinator";
import { runBufferedProcess } from "../utils/buffered_process";
import {
  choosePackageManagerFromSignal,
  getPackageManagerSignal,
} from "../utils/package_manager_selection";
import {
  getPackageManagerCommandEnv,
  getPnpmMinimumReleaseAgeSupport,
} from "../utils/socket_firewall";
import {
  findBuildOutputDir,
  isValidDeedPageSlug,
  publishBuildToDeedPage,
  suggestDeedPageSlug,
} from "@/deedpage_deploy/publish";

const logger = log.scope("deedpage_handlers");
const BUILD_TIMEOUT_MS = 10 * 60 * 1000;

// The build reads the working tree, so hold it steady while it runs.
const PUBLISH_RESOURCES = [
  readAppResource("app-path"),
  readAppResource("repository-worktree"),
] as const;

function getSavedSite(appId: number): DeedPageSite | null {
  return readSettings().deedPageSites?.[String(appId)] ?? null;
}

async function getApp(appId: number) {
  const app = await db.query.apps.findFirst({ where: eq(apps.id, appId) });
  if (!app) {
    throw new DyadError("App not found.", DyadErrorKind.NotFound);
  }
  return app;
}

async function buildApp(appPath: string): Promise<void> {
  const packageJsonPath = path.join(appPath, "package.json");
  if (!fs.existsSync(packageJsonPath)) {
    return; // A plain static app: publish it as it is.
  }
  const scripts = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"))
    .scripts as Record<string, string> | undefined;
  if (!scripts?.build) {
    return;
  }
  if (!fs.existsSync(path.join(appPath, "node_modules"))) {
    throw new DyadError(
      "Run the app once so its dependencies are installed, then publish.",
      DyadErrorKind.Precondition,
    );
  }
  const pnpmSupport = await getPnpmMinimumReleaseAgeSupport();
  const packageManager = choosePackageManagerFromSignal({
    signal: getPackageManagerSignal(appPath),
    pnpmAvailable: pnpmSupport.available,
  });
  const result = await runBufferedProcess({
    command: packageManager,
    args: ["run", "build"],
    cwd: appPath,
    env: getPackageManagerCommandEnv(),
    shell: process.platform === "win32",
    timeoutMs: BUILD_TIMEOUT_MS,
    maxOutputBytes: 256_000,
  });
  if (result.timedOut) {
    throw new DyadError(
      "The build took longer than 10 minutes.",
      DyadErrorKind.External,
    );
  }
  if (result.code !== 0) {
    const tail = `${result.stderr}\n${result.stdout}`
      .trim()
      .split("\n")
      .slice(-20)
      .join("\n");
    throw new DyadError(`The build failed:\n${tail}`, DyadErrorKind.External);
  }
}

export async function handlePublishToDeedPage({
  appId,
  slug: requestedSlug,
}: PublishToDeedPageParams): Promise<PublishToDeedPageResult> {
  const app = await getApp(appId);
  const appPath = getDyadAppPath(app.path);
  const saved = getSavedSite(appId);
  const slug =
    saved?.slug ?? requestedSlug?.trim() ?? suggestDeedPageSlug(app.name);
  if (!isValidDeedPageSlug(slug)) {
    throw new DyadError(
      "Use 1-63 lowercase letters, numbers, or dashes for the site name.",
      DyadErrorKind.Validation,
    );
  }

  await buildApp(appPath);
  const dir =
    (await findBuildOutputDir(appPath)) ??
    (fs.existsSync(path.join(appPath, "index.html")) &&
    !fs.existsSync(path.join(appPath, "package.json"))
      ? appPath
      : null);
  if (!dir) {
    throw new DyadError(
      "No build output with an index.html was found in dist, build, or out.",
      DyadErrorKind.Precondition,
    );
  }

  const settings = readSettings();
  let result;
  try {
    result = await publishBuildToDeedPage({
      dir,
      slug,
      token: settings.deedPageAccessToken?.value,
    });
  } catch (error) {
    throw new DyadError(
      `deed.page publish failed: ${(error as Error).message}`,
      DyadErrorKind.External,
    );
  }

  writeSettings({
    ...(result.token ? { deedPageAccessToken: { value: result.token } } : {}),
    deedPageSites: {
      ...readSettings().deedPageSites,
      [String(appId)]: { slug: result.slug, url: result.url },
    },
  });
  logger.log(`Published app ${appId} to ${result.url} (${result.version}).`);
  return { slug: result.slug, url: result.url, version: result.version };
}

export function registerDeedPageHandlers() {
  createTypedHandler(deedPageContracts.getSite, async (_, { appId }) => {
    return getSavedSite(appId);
  });

  // DO NOT LOG this handler's settings: it stores the deed.page owner token.
  createTypedHandler(
    deedPageContracts.publish,
    createAppOperationHandler(
      "deedpage:publish",
      PUBLISH_RESOURCES,
      async (_, params: PublishToDeedPageParams) => {
        return handlePublishToDeedPage(params);
      },
    ),
  );

  createTypedHandler(deedPageContracts.disconnect, async (_, { appId }) => {
    const sites = { ...readSettings().deedPageSites };
    delete sites[String(appId)];
    writeSettings({ deedPageSites: sites });
  });
}
