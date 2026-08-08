import fs from "node:fs/promises";

const GITHUB_API_VERSION = "2022-11-28";
const MAILGUN_API_BASE_URL = "https://api.mailgun.net/v3";
const ADVISORY_STATES = ["triage", "draft"];

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
      "SECURITY_ADVISORY_ALERT_EMAILS must contain at least one email address",
    );
  }

  return recipients;
};

const getNextPageUrl = (linkHeader) => {
  if (!linkHeader) {
    return null;
  }

  for (const part of linkHeader.split(",")) {
    const match = part.match(/<([^>]+)>;\s*rel="next"/);
    if (match) {
      return match[1];
    }
  }

  return null;
};

const readResponseBody = async (response) => {
  const text = await response.text();
  return text.trim().slice(0, 500);
};

const fetchAdvisoryCount = async ({ apiBaseUrl, repository, token, state }) => {
  let nextUrl = new URL(
    `${apiBaseUrl}/repos/${repository}/security-advisories`,
  );
  nextUrl.searchParams.set("state", state);
  nextUrl.searchParams.set("per_page", "100");

  let total = 0;

  while (nextUrl) {
    const response = await fetch(nextUrl, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": GITHUB_API_VERSION,
      },
    });

    if (!response.ok) {
      const body = await readResponseBody(response);
      throw new Error(
        `Failed to list ${state} security advisories: ${response.status} ${body}`,
      );
    }

    const advisories = await response.json();
    if (!Array.isArray(advisories)) {
      throw new Error(`Unexpected ${state} advisories response shape`);
    }

    total += advisories.length;

    const nextPage = getNextPageUrl(response.headers.get("link"));
    nextUrl = nextPage ? new URL(nextPage) : null;
  }

  return total;
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
      `Failed to send advisory email: ${response.status} ${body}`,
    );
  }
};

const main = async () => {
  const token = requireEnv("GITHUB_TOKEN");
  const repository = requireEnv("GITHUB_REPOSITORY");
  const mailgunApiKey = requireEnv("MAILGUN_API_KEY");
  const mailgunDomain = requireEnv("MAILGUN_DOMAIN");
  const fromEmail = requireEnv("MAILGUN_FROM_EMAIL");
  const recipients = parseRecipients(
    requireEnv("SECURITY_ADVISORY_ALERT_EMAILS"),
  );
  const githubApiBaseUrl =
    process.env.GITHUB_API_URL?.trim() || "https://api.github.com";
  const githubServerUrl =
    process.env.GITHUB_SERVER_URL?.trim() || "https://github.com";
  const runId = process.env.GITHUB_RUN_ID?.trim();

  const advisoryCounts = Object.fromEntries(
    await Promise.all(
      ADVISORY_STATES.map(async (state) => [
        state,
        await fetchAdvisoryCount({
          repository,
          token,
          state,
          apiBaseUrl: githubApiBaseUrl,
        }),
      ]),
    ),
  );
  const totalCount = ADVISORY_STATES.reduce(
    (sum, state) => sum + advisoryCounts[state],
    0,
  );

  const triageUrl = `${githubServerUrl}/${repository}/security/advisories?state=triage`;
  const draftUrl = `${githubServerUrl}/${repository}/security/advisories?state=draft`;
  const runUrl = runId
    ? `${githubServerUrl}/${repository}/actions/runs/${runId}`
    : null;

  await appendStepSummary(`Repository: \`${repository}\``);
  await appendStepSummary(`Triage advisories: ${advisoryCounts.triage}`);
  await appendStepSummary(`Draft advisories: ${advisoryCounts.draft}`);
  await appendStepSummary(
    `Total open advisories in triage/draft: ${totalCount}`,
  );

  if (totalCount === 0) {
    console.log(
      `No open triage or draft security advisories found for ${repository}.`,
    );
    return;
  }

  const subject = `[ALERT] You have ${totalCount} GitHub security advisories open for ${repository}`;
  const textLines = [
    `Repository: ${repository}`,
    "",
    `Open GitHub security advisories in triage/draft: ${totalCount}`,
    `Triage: ${advisoryCounts.triage}`,
    `Draft: ${advisoryCounts.draft}`,
    "",
    "Review advisories:",
    `Triage: ${triageUrl}`,
    `Draft: ${draftUrl}`,
  ];

  if (runUrl) {
    textLines.push("", `Workflow run: ${runUrl}`);
  }

  const html = `
<!doctype html>
<html>
  <body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#111827;line-height:1.5;">
    <h2 style="margin-bottom:12px;">GitHub security advisory alert</h2>
    <p style="margin:0 0 12px;"><strong>Repository:</strong> ${escapeHtml(repository)}</p>
    <p style="margin:0 0 12px;">
      Open GitHub security advisories in <code>triage</code>/<code>draft</code>: <strong>${totalCount}</strong>
    </p>
    <ul style="margin:0 0 16px;padding-left:20px;">
      <li>Triage: ${advisoryCounts.triage}</li>
      <li>Draft: ${advisoryCounts.draft}</li>
    </ul>
    <p style="margin:0 0 8px;"><a href="${escapeHtml(triageUrl)}">Review triage advisories</a></p>
    <p style="margin:0 0 8px;"><a href="${escapeHtml(draftUrl)}">Review draft advisories</a></p>
    ${runUrl ? `<p style="margin:16px 0 0;">Workflow run: <a href="${escapeHtml(runUrl)}">${escapeHtml(runUrl)}</a></p>` : ""}
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
    `Sent GitHub security advisory alert for ${repository} to ${recipients.length} recipient(s).`,
  );
};

await main();
