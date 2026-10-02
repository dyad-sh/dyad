import type { CloudflareTarget } from "./targets";

/**
 * The chat message behind the deployment card's "Fix with AI" button. Kept
 * apart from the card so the wording can be tested without rendering it.
 */
export function buildCloudflareDeployFixPrompt({
  workerName,
  rootDirectory,
  target,
  logTail,
}: {
  workerName: string;
  /** Path from the repository root, "" for the root itself. */
  rootDirectory: string;
  /** Null when the folder is no longer deployable on the branch. */
  target: CloudflareTarget | null;
  logTail: string[];
}): string {
  const folder =
    rootDirectory === "" ? "this app" : `the \`${rootDirectory}\` folder`;
  const preset =
    "The deploy rule sets NITRO_PRESET=cloudflare_module, so the build generates the Worker and its Wrangler config.";
  const config =
    target === null
      ? "Its Wrangler config or Nitro setup is missing from the current branch."
      : target.kind === "nitro"
        ? `It is a Nitro app. ${preset}`
        : target.nitro
          ? `It is a Nitro app with its own Wrangler config, \`${target.configPath}\`, which Nitro merges into the generated one. ${preset}`
          : `Its Wrangler config is \`${target.configPath}\`.`;
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
