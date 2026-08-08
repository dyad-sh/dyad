import fs from "node:fs/promises";

const GITHUB_API_VERSION = "2022-11-28";
const MAILGUN_API_BASE_URL = "https://api.mailgun.net/v3";

const requireEnv = (name) => {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
};

const parseRecipients = (value) => {
  const seen = new Set();
  const recipients = [];

  for (const entry of value.split(",")) {
    const email = entry.trim();
    if (!email || seen.has(email)) {
      continue;
    }
    seen.add(email);
    recipients.push(email);
  }

  if (recipients.length === 0) {
    throw new Error(
      "PR_REVIEW_ALERT_EMAILS must contain at least one email address",
    );
  }

  return recipients;
};

const readResponseBody = async (response) => {
  const text = await response.text();
  return text.trim().slice(0, 500);
};

const escapeHtml = (value) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const appendStepSummary = async (summary) => {
  const path = process.env.GITHUB_STEP_SUMMARY;
  if (!path) {
    return;
  }
  await fs.appendFile(path, `${summary}\n`, "utf8");
};

const fetchPRsNeedingReview = async ({ apiBaseUrl, token, username }) => {
  const query = `is:open is:pr review-requested:${username} org:dyad-sh`;
  const allPRs = [];
  let page = 1;

  while (true) {
    const url = new URL(`${apiBaseUrl}/search/issues`);
    url.searchParams.set("q", query);
    url.searchParams.set("per_page", "100");
    url.searchParams.set("page", String(page));

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": GITHUB_API_VERSION,
      },
    });

    if (!response.ok) {
      const body = await readResponseBody(response);
      throw new Error(
        `Failed to search PRs needing review: ${response.status} ${body}`,
      );
    }

    const data = await response.json();
    if (!data.items || !Array.isArray(data.items)) {
      throw new Error("Unexpected search response shape");
    }

    allPRs.push(...data.items);

    if (allPRs.length >= data.total_count || data.items.length === 0) {
      break;
    }

    page++;
  }

  return allPRs;
};

const sendMailgunEmail = async ({
  apiKey,
  domain,
  from,
  recipients,
  subject,
  text,
  html,
}) => {
  const response = await fetch(`${MAILGUN_API_BASE_URL}/${domain}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`api:${apiKey}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      from,
      to: recipients.join(","),
      subject,
      text,
      html,
    }),
  });

  if (!response.ok) {
    const body = await readResponseBody(response);
    throw new Error(
      `Failed to send PR review alert email: ${response.status} ${body}`,
    );
  }
};

const formatRepoName = (htmlUrl) => {
  const match = htmlUrl.match(/github\.com\/([^/]+\/[^/]+)\//);
  return match ? match[1] : "unknown";
};

const main = async () => {
  const token = requireEnv("GITHUB_TOKEN");
  const username = requireEnv("PR_REVIEW_GITHUB_USER");
  const mailgunApiKey = requireEnv("MAILGUN_API_KEY");
  const mailgunDomain = requireEnv("MAILGUN_DOMAIN");
  const fromEmail = requireEnv("MAILGUN_FROM_EMAIL");
  const recipients = parseRecipients(requireEnv("PR_REVIEW_ALERT_EMAILS"));
  const githubApiBaseUrl =
    process.env.GITHUB_API_URL?.trim() || "https://api.github.com";
  const githubServerUrl =
    process.env.GITHUB_SERVER_URL?.trim() || "https://github.com";
  const runId = process.env.GITHUB_RUN_ID?.trim();
  const repository = process.env.GITHUB_REPOSITORY?.trim() || "";

  const prs = await fetchPRsNeedingReview({
    apiBaseUrl: githubApiBaseUrl,
    token,
    username,
  });

  const totalCount = prs.length;

  await appendStepSummary(`GitHub user: \`${username}\``);
  await appendStepSummary(`PRs needing review: ${totalCount}`);

  if (totalCount === 0) {
    console.log(`No open PRs requesting review from ${username}.`);
    return;
  }

  // Group PRs by repo
  const prsByRepo = new Map();
  for (const pr of prs) {
    const repo = formatRepoName(pr.html_url);
    if (!prsByRepo.has(repo)) {
      prsByRepo.set(repo, []);
    }
    prsByRepo.get(repo).push(pr);
  }

  const subject = `[Review] You have ${totalCount} PR${totalCount === 1 ? "" : "s"} awaiting review`;

  // Build plain text
  const textLines = [
    `PRs requesting review from ${username}: ${totalCount}`,
    "",
  ];

  for (const [repo, repoPrs] of prsByRepo) {
    textLines.push(`${repo} (${repoPrs.length}):`);
    for (const pr of repoPrs) {
      textLines.push(`  - #${pr.number}: ${pr.title}`);
      textLines.push(`    ${pr.html_url}`);
    }
    textLines.push("");
  }

  const runUrl = runId
    ? `${githubServerUrl}/${repository}/actions/runs/${runId}`
    : null;
  if (runUrl) {
    textLines.push(`Workflow run: ${runUrl}`);
  }

  // Build HTML
  const prRowsHtml = Array.from(prsByRepo.entries())
    .map(([repo, repoPrs]) => {
      const prListHtml = repoPrs
        .map(
          (pr) =>
            `<li style="margin:4px 0;">
              <a href="${escapeHtml(pr.html_url)}">#${pr.number}</a>: ${escapeHtml(pr.title)}
              <span style="color:#6b7280;font-size:0.9em;">— ${escapeHtml(pr.user?.login || "unknown")}</span>
            </li>`,
        )
        .join("\n");

      return `
        <h3 style="margin:16px 0 8px;font-size:1em;">${escapeHtml(repo)} (${repoPrs.length})</h3>
        <ul style="margin:0 0 8px;padding-left:20px;">${prListHtml}</ul>
      `;
    })
    .join("\n");

  const html = `
<!doctype html>
<html>
  <body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#111827;line-height:1.5;">
    <h2 style="margin-bottom:12px;">PRs awaiting your review</h2>
    <p style="margin:0 0 12px;">
      Open PRs requesting review from <strong>${escapeHtml(username)}</strong>: <strong>${totalCount}</strong>
    </p>
    ${prRowsHtml}
    ${runUrl ? `<p style="margin:16px 0 0;font-size:0.9em;color:#6b7280;">Workflow run: <a href="${escapeHtml(runUrl)}">${escapeHtml(runUrl)}</a></p>` : ""}
  </body>
</html>
  `.trim();

  await sendMailgunEmail({
    apiKey: mailgunApiKey,
    domain: mailgunDomain,
    from: fromEmail,
    recipients,
    subject,
    text: textLines.join("\n"),
    html,
  });

  console.log(
    `Sent PR review alert for ${username} (${totalCount} PR(s)) to ${recipients.length} recipient(s).`,
  );
};

await main();
