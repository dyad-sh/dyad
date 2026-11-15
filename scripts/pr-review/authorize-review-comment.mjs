// A comment author may request static review of any open PR. PR authorship and
// author_association are deliberately not used as authorization signals.
export async function authorizeReviewComment({ github, context }) {
  const { comment, issue, action } = context.payload;
  if (
    context.eventName !== "issue_comment" ||
    action !== "created" ||
    !issue?.pull_request ||
    !Number.isSafeInteger(issue.number) ||
    issue.number <= 0 ||
    comment?.user?.type !== "User" ||
    !comment.user.login ||
    typeof comment.body !== "string" ||
    comment.body.trim() !== "@dyad-assistant /review"
  ) {
    return null;
  }

  const { owner, repo } = context.repo;
  let access;
  try {
    ({ data: access } = await github.rest.repos.getCollaboratorPermissionLevel({
      owner,
      repo,
      username: comment.user.login,
    }));
  } catch (error) {
    // GitHub can return 404 for non-collaborators. Treat that as a normal
    // denial; other API failures still fail closed rather than granting access.
    if (error?.status === 404) return null;
    throw error;
  }
  if (!["write", "maintain", "admin"].includes(access.permission)) {
    return null;
  }

  const { data: pullRequest } = await github.rest.pulls.get({
    owner,
    repo,
    pull_number: issue.number,
  });
  return pullRequest.state === "open" ? issue.number : null;
}
