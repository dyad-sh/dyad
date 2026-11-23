import { eq } from "drizzle-orm";
import { db } from "../../db";
import { apps } from "../../db/schema";
import {
  resolveAppGitRemote,
  type AppGitRemoteColumns,
} from "./app_git_remote";

/**
 * Records the branch an app is now on, in the column its provider reads.
 *
 * Switching and renaming used to go through `updateAppGithubRepo`, which
 * writes the GitHub columns and only those. A GitLab-linked app therefore
 * kept the branch it was linked on while its `github_branch` moved, and
 * `resolveAppGitRemote` — which reads `gitlabBranch` for a GitLab app — kept
 * handing the old branch to push and pull. The result was a sync that
 * reported success having pushed a branch the user had moved off.
 *
 * Only the branch is written. The old call also re-wrote the org and repo,
 * which was a no-op for a GitHub app and wrote an empty string into
 * `github_repo` for every other one.
 */
export async function updateAppLinkedBranch({
  app,
  branch,
}: {
  app: { id: number } & AppGitRemoteColumns;
  branch: string;
}): Promise<void> {
  const remote = resolveAppGitRemote(app);
  await db
    .update(apps)
    .set(
      // An app linked to nothing keeps writing github_branch, as it always
      // has: nothing reads it until the app is linked, and linking writes
      // the branch itself.
      remote?.provider === "gitlab"
        ? { gitlabBranch: branch }
        : { githubBranch: branch },
    )
    .where(eq(apps.id, app.id));
}
