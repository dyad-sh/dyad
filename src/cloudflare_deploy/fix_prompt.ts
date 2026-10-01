/**
 * The chat message behind the deployment card's "Fix with AI" button. Kept
 * apart from the card so the wording can be tested without rendering it.
 */
export function buildCloudflareDeployFixPrompt({
  workerName,
  rootDirectory,
  configPath,
  logTail,
}: {
  workerName: string;
  /** Path from the repository root, "" for the root itself. */
  rootDirectory: string;
  /** Null when the folder's Wrangler config is no longer on the branch. */
  configPath: string | null;
  logTail: string[];
}): string {
  const folder =
    rootDirectory === "" ? "this app" : `the \`${rootDirectory}\` folder`;
  const config = configPath
    ? `Its Wrangler config is \`${configPath}\`.`
    : "Its Wrangler config is missing from the current branch.";
  const sections = [
    `The Cloudflare Workers deployment of ${folder} to the Worker "${workerName}" failed. ${config} Find the cause in the config or the code and fix it.`,
  ];
  if (logTail.length > 0) {
    const log = logTail.join("\n");
    // A fence can only be closed by a run at least as long as itself, and
    // Wrangler's own hints contain triple-backtick runs.
    const fence = "`".repeat(Math.max(3, longestBacktickRun(log) + 1));
    sections.push(`Build log:\n${fence}\n${log}\n${fence}`);
  }
  return sections.join("\n\n");
}

function longestBacktickRun(text: string): number {
  let longest = 0;
  for (const run of text.match(/`+/g) ?? []) {
    longest = Math.max(longest, run.length);
  }
  return longest;
}
