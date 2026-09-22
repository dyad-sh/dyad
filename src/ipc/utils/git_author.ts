import { readSettings } from "../../main/settings";
import { getGithubUser } from "../handlers/github_handlers";

export interface GitAuthor {
  name: string;
  email: string;
}

/** Used when no provider is connected, so commits still have an identity. */
const DYAD_FALLBACK_EMAIL = "git@dyad.sh";

/**
 * The identity Dyad commits under.
 *
 * GitLab, like GitHub, attributes a commit to an account by its author email.
 * A GitLab-only user has no GitHub identity to read, and stamping every commit
 * with Dyad's own address left their work unattributed on their own project
 * for good — and, on an instance with a committer-email push rule, rejected
 * outright. GitHub stays first for an account connected to both, which is what
 * it did before GitLab existed.
 */
export async function getGitAuthor(): Promise<GitAuthor> {
  const githubEmail = (await getGithubUser())?.email;
  return {
    name: "Dyad",
    email: githubEmail || gitLabUserEmail() || DYAD_FALLBACK_EMAIL,
  };
}

function gitLabUserEmail(): string | null {
  return readSettings().gitlab?.user?.email || null;
}
