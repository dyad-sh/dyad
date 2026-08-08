import { getGithubUser } from "../handlers/github_handlers";

export async function getGitAuthor() {
  const user = await getGithubUser();
  const author = user
    ? {
        name: `[dyad]`,
        email: user.email,
      }
    : {
        name: "[dyad]",
        email: "git@dyad.sh",
      };
  return author;
}
