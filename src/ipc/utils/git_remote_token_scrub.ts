import log from "electron-log";
import fs from "node:fs/promises";
import path from "node:path";
import { getDyadAppPath } from "@/paths/paths";
import { db } from "@/db";
import { apps } from "@/db/schema";

const logger = log.scope("git_remote_token_scrub");

/**
 * Matches credentials embedded in a remote URL for one host, e.g.
 * https://<token>:x-oauth-basic@github.com/owner/repo.git
 * The lookahead ensures the host is exactly the one given, not a prefixed
 * host like github.company.com.
 *
 * `:` is deliberately not a terminator. The port is already part of `host`
 * when the managed instance has one, so allowing `:` to end the match would
 * make a portless `gitlab.example.com` also match `gitlab.example.com:8443` —
 * a different instance, whose credentials the user configured by hand.
 */
function embeddedCredentialsRegex(host: string): RegExp {
  const escaped = host.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(https?:\\/\\/)[^@/\\s]+@${escaped}(?=[/\\s]|$)`, "g");
}

/**
 * The hosts Dyad manages credentials for on this app: github.com always, and
 * the GitLab instance the app is linked to, if any. Only those — a remote the
 * user configured by hand on some other host is theirs, credentials and all.
 */
export function managedRemoteHosts(app: {
  gitlabHost: string | null;
}): string[] {
  const hosts = ["github.com"];
  if (app.gitlabHost) {
    try {
      hosts.push(new URL(app.gitlabHost).host);
    } catch {
      // A host that does not parse cannot be in a remote URL either.
    }
  }
  return hosts;
}

/**
 * Removes access tokens that older Dyad versions embedded in remote URLs
 * (.git/config). Auth is now injected per-invocation via environment
 * variables, so a URL-embedded token is both unnecessary and a plaintext
 * credential sitting on disk. Run on app startup.
 */
export async function scrubTokensFromRemotes(): Promise<void> {
  try {
    const allApps = await db
      .select({ path: apps.path, gitlabHost: apps.gitlabHost })
      .from(apps);

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

        let scrubbed = original;
        for (const host of managedRemoteHosts(app)) {
          scrubbed = scrubbed.replace(
            embeddedCredentialsRegex(host),
            `$1${host}`,
          );
        }
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
        `Scrubbed embedded credentials from ${totalScrubbed} app git config(s)`,
      );
    }
  } catch (err) {
    logger.warn("Failed to scrub embedded credentials from git remotes:", err);
  }
}
