import { getGithubUser } from "../handlers/github_handlers";

export async function getGitAuthor() {
  const user = await getGithubUser();
  const author = user
    ? {
        name: `[joy]`,
        email: user.email,
      }
    : {
        name: "[joy]",
        email: "git@joycreate.app",
      };
  return author;
}
