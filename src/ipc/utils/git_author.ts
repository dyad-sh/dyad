import { getGithubUser } from "../handlers/github_handlers";

export async function getGitAuthor() {
  const user = await getGithubUser();
  const author = user
    ? {
        name: `[coney]`,
        email: user.email,
      }
    : {
        name: "[coney]",
        email: "git@coney.sh",
      };
  return author;
}
