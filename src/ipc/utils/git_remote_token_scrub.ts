import log from "electron-log";
import fs from "node:fs/promises";
import path from "node:path";
import { getDyadAppPath } from "@/paths/paths";
import { db } from "@/db";
import { apps } from "@/db/schema";

const logger = log.scope("git_remote_token_scrub");

// Matches credentials embedded in GitHub remote URLs, e.g.
// https://<token>:x-oauth-basic@github.com/owner/repo.git
// The lookahead ensures the host is exactly github.com, not a
// prefixed host like github.company.com.
const EMBEDDED_GITHUB_CREDENTIALS_REGEX =
  /(https?:\/\/)[^@/\s]+@github\.com(?=[/:\s]|$)/g;

/**
 * Removes GitHub access tokens that older Dyad versions embedded in remote
 * URLs (.git/config). Auth is now injected per-invocation via environment
 * variables, so a URL-embedded token is both unnecessary and a plaintext
 * credential sitting on disk. Run on app startup.
 */
export async function scrubGithubTokenFromRemotes(): Promise<void> {
  try {
    const allApps = await db.select({ path: apps.path }).from(apps);

    const counts = await Promise.all(
      allApps.map(async (app) => {
        const configPath = path.join(
          getDyadAppPath(app.path),
          ".git",
          "config",
        );

        let original: string;
        try {
          original = await fs.readFile(configPath, "utf8");
        } catch {
          return 0;
        }

        const scrubbed = original.replace(
          EMBEDDED_GITHUB_CREDENTIALS_REGEX,
          "$1github.com",
        );
        if (scrubbed === original) {
          return 0;
        }

        try {
          // Write to a temp file and rename so a crash mid-write can't
          // truncate the repo's config.
          const tempPath = `${configPath}.dyad-scrub-tmp`;
          await fs.writeFile(tempPath, scrubbed, "utf8");
          await fs.rename(tempPath, configPath);
          return 1;
        } catch (err) {
          logger.warn(`Failed to scrub credentials from ${configPath}:`, err);
          return 0;
        }
      }),
    );

    const totalScrubbed = counts.reduce<number>((sum, n) => sum + n, 0);
    if (totalScrubbed > 0) {
      logger.log(
        `Scrubbed embedded GitHub credentials from ${totalScrubbed} app git config(s)`,
      );
    }
  } catch (err) {
    logger.warn("Failed to scrub GitHub tokens from git remotes:", err);
  }
}
