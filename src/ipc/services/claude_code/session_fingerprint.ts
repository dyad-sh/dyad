import { createHash } from "node:crypto";

function replaceEvery(text: string, from: string, to: string): string {
  return from ? text.split(from).join(to) : text;
}

/**
 * Identifies what a Claude Code CLI session was started with, so a later turn
 * resumes it only when the app, system prompt, and tool inventory still match.
 *
 * Under worktree isolation a chat's turns move between the app's own folder
 * and its isolated worktree. That move must not end the session, so the
 * fingerprint uses the app's folder, and the system prompt is hashed as if it
 * named that folder instead of the worktree (the shell guidance embeds the
 * turn's starting directory, JSON-escaped). A turn in the app's own folder
 * hashes exactly as it did before isolation existed.
 */
export function claudeSessionFingerprint({
  appPath,
  turnPath,
  system,
  declarations,
}: {
  /** The app's own folder, whichever directory this turn works in. */
  appPath: string;
  /** The directory this turn reads and edits. */
  turnPath: string;
  system: string;
  declarations: unknown;
}): string {
  let stableSystem = system;
  if (turnPath !== appPath) {
    const escaped = (value: string) => JSON.stringify(value).slice(1, -1);
    stableSystem = replaceEvery(
      replaceEvery(stableSystem, escaped(turnPath), escaped(appPath)),
      turnPath,
      appPath,
    );
  }
  return createHash("sha256")
    .update(JSON.stringify([appPath, stableSystem, declarations]))
    .digest("hex");
}
