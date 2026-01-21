import { getGithubUser } from "../handlers/github_handlers";

export async function getGitAuthor() {
  const user = await getGithubUser();
  const author = user
    ? {
        name: `[abba-ai]`,
        email: user.email,
      }
    : {
        name: "[abba-ai]",
        email: "git@abba.ai",
      };
  return author;
}
