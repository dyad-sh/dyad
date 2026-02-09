// Shared logic for applying needs-human:* labels to PRs based on CI status and code review results.
// Used by both pr-review-responder.yml (for cc:request PRs) and pr-status-labeler.yml (for all other PRs).

const LABEL_REVIEW_ISSUE = "needs-human:review-issue";
const LABEL_FINAL_CHECK = "needs-human:final-check";

const LABEL_DEFS = {
  [LABEL_REVIEW_ISSUE]: {
    color: "d93f0b",
    description: "PR needs human attention - review issue or CI failure",
  },
  [LABEL_FINAL_CHECK]: {
    color: "0e8a16",
    description:
      "PR is green and review-clean - ready for final human check before merge",
  },
};

const REVIEW_MARKER = "Dyadbot Code Review Summary";

async function ensureLabel(github, owner, repo, name) {
  const def = LABEL_DEFS[name];
  try {
    await github.rest.issues.createLabel({
      owner,
      repo,
      name,
      color: def.color,
      description: def.description,
    });
  } catch {
    // Label already exists, ignore
  }
}

function findLatestReviewComment(comments) {
  for (let i = comments.length - 1; i >= 0; i--) {
    const body = comments[i].body || "";
    if (body.includes(REVIEW_MARKER)) {
      return body;
    }
  }
  return null;
}

function isReviewClean(body) {
  // Swarm verdict: explicit "YES - Ready to merge"
  if (body.includes("YES - Ready to merge")) {
    return true;
  }

  // Multi-agent: no issues found
  if (
    body.includes(":white_check_mark: No issues found") ||
    body.includes(":white_check_mark: No new issues found")
  ) {
    return true;
  }

  // If there are HIGH or MEDIUM severity markers, review has issues
  if (body.includes(":red_circle:") || body.includes(":yellow_circle:")) {
    return false;
  }

  // Swarm verdicts indicating issues
  if (
    body.includes("NOT SURE - Potential issues") ||
    body.includes("NO - Do NOT merge")
  ) {
    return false;
  }

  // No clear signal — treat as clean (e.g. only low-priority items)
  return true;
}

async function applyLabel(github, owner, repo, prNumber, addLabel) {
  const removeLabel =
    addLabel === LABEL_REVIEW_ISSUE ? LABEL_FINAL_CHECK : LABEL_REVIEW_ISSUE;

  await ensureLabel(github, owner, repo, addLabel);
  await ensureLabel(github, owner, repo, removeLabel);

  await github.rest.issues.addLabels({
    owner,
    repo,
    issue_number: prNumber,
    labels: [addLabel],
  });

  await github.rest.issues
    .removeLabel({
      owner,
      repo,
      issue_number: prNumber,
      name: removeLabel,
    })
    .catch(() => {});
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

  // Fetch PR comments to find the latest code review summary
  const { data: comments } = await github.rest.issues.listComments({
    owner,
    repo,
    issue_number: prNumber,
  });

  const reviewBody = findLatestReviewComment(comments);

  if (!reviewBody && ciSuccess) {
    core.info("CI passed but no review comment found, skipping label update");
    return;
  }

  if (!reviewBody && !ciSuccess) {
    core.info(
      "CI failed and no review comment found, adding review-issue label",
    );
    await applyLabel(github, owner, repo, prNumber, LABEL_REVIEW_ISSUE);
    return;
  }

  const reviewClean = isReviewClean(reviewBody);

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
