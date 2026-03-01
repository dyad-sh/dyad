// Shared logic for applying needs-human:* labels to PRs based on CI status and code review results.
// Used by both pr-review-responder.yml (for cc:request PRs) and pr-status-labeler.yml (for all other PRs).

const LABEL_REVIEW_ISSUE = "needs-human:review-issue";
const LABEL_FINAL_CHECK = "needs-human:final-check";

const REVIEW_MARKER = "Coneybot Code Review Summary";

// Review verdict strings — keep in sync with:
//   Swarm verdicts: .claude/skills/swarm-pr-review/SKILL.md
//   Multi-agent output: .claude/skills/multi-pr-review/scripts/post_comment.py
const SWARM_VERDICT_CLEAN = "YES - Ready to merge";
const SWARM_VERDICT_UNSURE = "NOT SURE - Potential issues";
const SWARM_VERDICT_REJECT = "NO - Do NOT merge";
const MULTI_AGENT_NO_ISSUES = ":white_check_mark: No issues found";
const MULTI_AGENT_NO_NEW_ISSUES = ":white_check_mark: No new issues found";
// Severity table regexes match "| :emoji: LEVEL | N |" rows with non-zero counts
const HIGH_ISSUES_RE = /:red_circle:.*?\|\s*[1-9]/;
const MEDIUM_ISSUES_RE = /:yellow_circle:.*?\|\s*[1-9]/;
const LOW_ISSUES_RE = /:green_circle:.*?\|\s*\d/;

function findLatestReviewComment(comments) {
  for (let i = comments.length - 1; i >= 0; i--) {
    const body = comments[i].body || "";
    const user = comments[i].user || {};
    if (body.includes(REVIEW_MARKER) && user.type === "Bot") {
      return comments[i];
    }
  }
  return null;
}

function isReviewClean(body) {
  // Swarm verdict: explicit clean
  if (body.includes(SWARM_VERDICT_CLEAN)) {
    return true;
  }

  // Multi-agent: no issues found
  if (
    body.includes(MULTI_AGENT_NO_ISSUES) ||
    body.includes(MULTI_AGENT_NO_NEW_ISSUES)
  ) {
    return true;
  }

  // If there are HIGH or MEDIUM severity markers with non-zero counts, review has issues.
  // The severity table always renders rows like "| :red_circle: HIGH | 0 |" even at count 0,
  // so we match only rows where the count is >= 1.
  if (body.match(HIGH_ISSUES_RE) || body.match(MEDIUM_ISSUES_RE)) {
    return false;
  }

  // Multi-agent: severity table present with only LOW issues (HIGH=0 and MEDIUM=0
  // already passed the regex check above, so reaching here means only LOW remain)
  if (body.match(LOW_ISSUES_RE)) {
    return true;
  }

  // Swarm verdicts indicating issues
  if (
    body.includes(SWARM_VERDICT_UNSURE) ||
    body.includes(SWARM_VERDICT_REJECT)
  ) {
    return false;
  }

  // No clear signal — fail-closed: flag for human review rather than
  // silently treating an unrecognized format as clean.
  return false;
}

async function applyLabel(github, owner, repo, prNumber, addLabel) {
  const removeLabel =
    addLabel === LABEL_REVIEW_ISSUE ? LABEL_FINAL_CHECK : LABEL_REVIEW_ISSUE;

  // Atomically swap labels using setLabels to avoid a window where both exist
  const { data: currentLabels } = await github.rest.issues.listLabelsOnIssue({
    owner,
    repo,
    issue_number: prNumber,
  });

  const newLabelSet = new Set(currentLabels.map((label) => label.name));
  newLabelSet.delete(removeLabel);
  newLabelSet.add(addLabel);

  await github.rest.issues.setLabels({
    owner,
    repo,
    issue_number: prNumber,
    labels: [...newLabelSet],
  });
}

async function run({ github, context, core, prNumber, ciConclusion }) {
  const owner = context.repo.owner;
  const repo = context.repo.repo;

  // Bail on cancelled/skipped runs — inconclusive
  if (ciConclusion === "cancelled" || ciConclusion === "skipped") {
    core.info(`CI conclusion is '${ciConclusion}', skipping label update`);
    return;
  }

  const ciSuccess = ciConclusion === "success";

  // Fetch all PR comments (paginated) to find the latest code review summary
  const comments = await github.paginate(github.rest.issues.listComments, {
    owner,
    repo,
    issue_number: prNumber,
  });

  const reviewComment = findLatestReviewComment(comments);

  if (!reviewComment && ciSuccess) {
    core.info("CI passed but no review comment found, skipping label update");
    return;
  }

  if (!reviewComment && !ciSuccess) {
    core.info(
      "CI failed and no review comment found, adding review-issue label",
    );
    await applyLabel(github, owner, repo, prNumber, LABEL_REVIEW_ISSUE);
    return;
  }

  // Check if the review is stale (posted before the latest commit)
  const { data: pull } = await github.rest.pulls.get({
    owner,
    repo,
    pull_number: prNumber,
  });
  const { data: headCommit } = await github.rest.repos.getCommit({
    owner,
    repo,
    ref: pull.head.sha,
  });

  const commitDate = new Date(headCommit.commit.committer.date);
  const reviewDate = new Date(reviewComment.created_at);

  if (reviewDate < commitDate) {
    core.info(
      "Latest review is stale (posted before latest commit), adding review-issue label",
    );
    await applyLabel(github, owner, repo, prNumber, LABEL_REVIEW_ISSUE);
    return;
  }

  const reviewClean = isReviewClean(reviewComment.body);

  if (ciSuccess && reviewClean) {
    core.info("CI passed and review is clean, adding final-check label");
    await applyLabel(github, owner, repo, prNumber, LABEL_FINAL_CHECK);
  } else {
    core.info(
      `CI ${ciSuccess ? "passed" : "failed"}, review ${reviewClean ? "clean" : "has issues"}, adding review-issue label`,
    );
    await applyLabel(github, owner, repo, prNumber, LABEL_REVIEW_ISSUE);
  }
}

module.exports = { run };
