import log from "electron-log";
import fetch from "node-fetch";
import { IS_TEST_BUILD } from "../utils/test_utils";
import { createTypedHandler } from "./base";
import { systemContracts } from "../types/system";

const logger = log.scope("release_note_handlers");

type ReleaseNoteResult = {
  exists: boolean;
  url?: string;
};

const releaseNoteResultCache = new Map<string, ReleaseNoteResult>();
const pendingReleaseNoteChecks = new Map<string, Promise<ReleaseNoteResult>>();

async function checkReleaseNoteExists(
  version: string,
): Promise<ReleaseNoteResult> {
  const releaseNoteUrl = `https://www.dyad.sh/docs/releases/${version}`;

  const cached = releaseNoteResultCache.get(version);
  if (cached) {
    return cached;
  }

  const pending = pendingReleaseNoteChecks.get(version);
  if (pending) {
    return pending;
  }

  if (IS_TEST_BUILD) {
    return { exists: false };
  }

  const checkPromise = (async () => {
    logger.debug(`Checking for release note at: ${releaseNoteUrl}`);

    try {
      const response = await fetch(releaseNoteUrl, { method: "HEAD" });
      if (response.ok) {
        logger.debug(
          `Release note found for version ${version} at ${releaseNoteUrl}`,
        );
        return { exists: true, url: releaseNoteUrl };
      } else if (response.status === 404) {
        logger.debug(
          `Release note not found for version ${version} at ${releaseNoteUrl}`,
        );
        return { exists: false };
      } else {
        logger.warn(
          `Unexpected status code ${response.status} when checking for release note: ${releaseNoteUrl}`,
        );
        return { exists: false };
      }
    } catch (error) {
      logger.error(
        `Error fetching release note for version ${version} at ${releaseNoteUrl}:`,
        error,
      );
      return { exists: false };
    }
  })();

  pendingReleaseNoteChecks.set(version, checkPromise);
  const result = await checkPromise.finally(() => {
    pendingReleaseNoteChecks.delete(version);
  });
  releaseNoteResultCache.set(version, result);
  return result;
}

export function registerReleaseNoteHandlers() {
  createTypedHandler(
    systemContracts.doesReleaseNoteExist,
    async (_, params) => {
      const { version } = params;

      if (!version || typeof version !== "string") {
        throw new Error("Invalid version provided");
      }

      return checkReleaseNoteExists(version);
    },
  );

  logger.debug("Registered release note IPC handlers");
}
