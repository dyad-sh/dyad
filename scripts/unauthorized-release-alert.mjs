import fs from "node:fs/promises";
import { pathToFileURL } from "node:url";

const MAILGUN_API_BASE_URL = "https://api.mailgun.net/v3";

const requireEnv = (name) => {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
};

const optionalEnv = (name) => process.env[name]?.trim() || "";

export const parseRecipients = (value) => {
  const recipients = [
    ...new Set(value.split(",").map((entry) => entry.trim())),
  ].filter(Boolean);

  if (recipients.length === 0) {
    throw new Error(
      "UNAUTHORIZED_RELEASE_ALERT_EMAILS must contain at least one email address",
    );
  }

  return recipients;
};

const escapeHtml = (value) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const readResponseBody = async (response) => {
  const text = await response.text();
  return text.trim().slice(0, 500);
};

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
      `Failed to send unauthorized release email: ${response.status} ${body}`,
    );
  }
};

export const createReleaseAlert = ({
  repository,
  releaseId,
  releaseTag,
  releaseAuthor,
  deleteResult,
  releaseName,
  createdAt,
  publishedAt,
  runUrl,
}) => {
  const deletionSucceeded = deleteResult === "success";
  const outcome = deletionSucceeded
    ? "The unauthorized release was deleted automatically. Its Git tag was not deleted."
    : `Automatic deletion did not succeed (job result: ${deleteResult}). Remove the release manually and investigate the workflow run.`;
  const subjectPrefix = deletionSucceeded ? "[ALERT]" : "[URGENT]";
  const subject = `${subjectPrefix} Unauthorized release ${releaseTag} in ${repository}`;

  const text = [
    "An unauthorized GitHub release was published by someone other than github-actions[bot].",
    "",
    `Repository: ${repository}`,
    `Release: ${releaseName}`,
    `Tag: ${releaseTag}`,
    `Release ID: ${releaseId}`,
    `Author: ${releaseAuthor}`,
    `Created at: ${createdAt}`,
    `Published at: ${publishedAt}`,
    `Deletion job result: ${deleteResult}`,
    "",
    outcome,
    "",
    `Workflow run: ${runUrl}`,
  ].join("\n");

  const html = `
<!doctype html>
<html>
  <body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#111827;line-height:1.5;">
    <h2 style="margin-bottom:12px;">Unauthorized GitHub release detected</h2>
    <p>A release was published by someone other than <code>github-actions[bot]</code>.</p>
    <ul style="padding-left:20px;">
      <li><strong>Repository:</strong> ${escapeHtml(repository)}</li>
      <li><strong>Release:</strong> ${escapeHtml(releaseName)}</li>
      <li><strong>Tag:</strong> <code>${escapeHtml(releaseTag)}</code></li>
      <li><strong>Release ID:</strong> <code>${escapeHtml(releaseId)}</code></li>
      <li><strong>Author:</strong> <code>${escapeHtml(releaseAuthor)}</code></li>
      <li><strong>Created at:</strong> ${escapeHtml(createdAt)}</li>
      <li><strong>Published at:</strong> ${escapeHtml(publishedAt)}</li>
      <li><strong>Deletion job result:</strong> <code>${escapeHtml(deleteResult)}</code></li>
    </ul>
    <p><strong>${escapeHtml(outcome)}</strong></p>
    <p><a href="${escapeHtml(runUrl)}">Review the workflow run</a></p>
  </body>
</html>
  `.trim();

  return { html, outcome, subject, text };
};

const main = async () => {
  const repository = requireEnv("GITHUB_REPOSITORY");
  const releaseId = requireEnv("RELEASE_ID");
  const releaseTag = requireEnv("RELEASE_TAG");
  const releaseAuthor = requireEnv("RELEASE_AUTHOR");
  const deleteResult = requireEnv("DELETE_RESULT");
  const mailgunApiKey = requireEnv("MAILGUN_API_KEY");
  const mailgunDomain = requireEnv("MAILGUN_DOMAIN");
  const fromEmail = requireEnv("MAILGUN_FROM_EMAIL");
  const recipients = parseRecipients(
    requireEnv("UNAUTHORIZED_RELEASE_ALERT_EMAILS"),
  );
  const releaseName = optionalEnv("RELEASE_NAME") || releaseTag;
  const createdAt = optionalEnv("RELEASE_CREATED_AT") || "unknown";
  const publishedAt = optionalEnv("RELEASE_PUBLISHED_AT") || "unknown";
  const githubServerUrl =
    optionalEnv("GITHUB_SERVER_URL") || "https://github.com";
  const runId = optionalEnv("GITHUB_RUN_ID");
  const runUrl = runId
    ? `${githubServerUrl}/${repository}/actions/runs/${runId}`
    : `${githubServerUrl}/${repository}/actions`;
  const { html, subject, text } = createReleaseAlert({
    repository,
    releaseId,
    releaseTag,
    releaseAuthor,
    deleteResult,
    releaseName,
    createdAt,
    publishedAt,
    runUrl,
  });

  await appendStepSummary(`Email recipients: ${recipients.length}`);
  await appendStepSummary(`Deletion job result: \`${deleteResult}\``);

  await sendMailgunEmail({
    apiKey: mailgunApiKey,
    domain: mailgunDomain,
    from: fromEmail,
    recipients,
    subject,
    text,
    html,
  });

  console.log(
    `Sent unauthorized release alert for ${repository}@${releaseTag} to ${recipients.length} recipient(s).`,
  );
};

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await main();
}
