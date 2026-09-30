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
    sections.push(`Build log:\n\`\`\`\n${logTail.join("\n")}\n\`\`\``);
  }
  return sections.join("\n\n");
}
