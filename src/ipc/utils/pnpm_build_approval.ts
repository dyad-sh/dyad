import fs from "node:fs";
import path from "node:path";

/**
 * Approves the build scripts a generated app needs, so `pnpm install` succeeds.
 *
 * pnpm 11 made unapproved dependency build scripts a hard error rather than a
 * warning, and `pnpm run dev` verifies the install before it starts. An app
 * whose esbuild postinstall was never approved therefore fails install, fails
 * `run dev`, and the preview sits on "starting up app server" forever with the
 * real reason buried in a stack trace.
 *
 * On a failed install pnpm writes a `pnpm-workspace.yaml` containing an
 * `allowBuilds` block with placeholder values, expecting a human to edit it.
 * Nothing in the app ever does, so this fills it in.
 */

export const PNPM_WORKSPACE_FILENAME = "pnpm-workspace.yaml";

/**
 * Build scripts approved automatically: the compilers and native helpers these
 * templates are built on. Anything else stays unapproved — a generated app
 * pulling in an unfamiliar package should not get arbitrary postinstall
 * execution just because it would be convenient.
 */
export const AUTO_APPROVED_BUILDS = [
  "@swc/core",
  "@parcel/watcher",
  "@tailwindcss/oxide",
  "esbuild",
  "sharp",
  "unrs-resolver",
] as const;

const PLACEHOLDER = /^(?:set this to true or false|<[^>]*>)$/i;

function quoteKey(name: string): string {
  return name.startsWith("@") ? `"${name}"` : name;
}

function allowBuildsBlock(names: readonly string[]): string {
  return [
    "allowBuilds:",
    ...names.map((name) => `  ${quoteKey(name)}: true`),
  ].join("\n");
}

export type ApprovalResult = {
  /** File contents to write, or null when nothing needs changing. */
  contents: string | null;
  /** Dependencies left unapproved because they are not on the allowlist. */
  skipped: string[];
};

/**
 * The workspace file an app should have, given what it has now.
 *
 * Deliberately textual rather than a YAML round-trip: the file is either absent
 * or the small block pnpm generates, and rewriting a user's YAML through a
 * parser would reformat everything around it.
 */
export function applyBuildApprovals(
  existing: string | null,
  approved: readonly string[] = AUTO_APPROVED_BUILDS,
): ApprovalResult {
  if (existing == null || existing.trim() === "") {
    return { contents: `${allowBuildsBlock(approved)}\n`, skipped: [] };
  }

  const lines = existing.split(/\r?\n/);
  const startIndex = lines.findIndex((line) => /^allowBuilds:\s*$/.test(line));

  if (startIndex < 0) {
    const separator = existing.endsWith("\n") ? "" : "\n";
    return {
      contents: `${existing}${separator}${allowBuildsBlock(approved)}\n`,
      skipped: [],
    };
  }

  const skipped: string[] = [];
  let changed = false;
  const seen = new Set<string>();

  let index = startIndex + 1;
  for (; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trim() === "") continue;
    // The block ends at the first line that is not indented.
    if (!/^\s+\S/.test(line)) break;

    const entry = /^(\s+)(['"]?)([^'":]+)\2\s*:\s*(.*)$/.exec(line);
    if (!entry) continue;
    const [, indent, , name, rawValue] = entry;
    seen.add(name);

    const value = rawValue.trim().replace(/^['"]|['"]$/g, "");
    if (value === "true" || value === "false") continue;
    if (!PLACEHOLDER.test(value) && value !== "") continue;

    if (approved.includes(name)) {
      lines[index] = `${indent}${quoteKey(name)}: true`;
      changed = true;
    } else {
      skipped.push(name);
    }
  }

  // Approvals this app has never listed are not added: only what pnpm asked
  // about matters, and an empty allowlist entry is noise.
  if (!changed) return { contents: null, skipped };

  return { contents: `${lines.join("\n")}`, skipped };
}

/**
 * Fills in build approvals for an app on disk.
 *
 * Returns the dependencies left unapproved, so a caller can say why an install
 * is still going to fail rather than leaving the user staring at a spinner.
 */
export async function ensurePnpmBuildsApproved(
  appPath: string,
): Promise<{ updated: boolean; skipped: string[] }> {
  const filePath = path.join(appPath, PNPM_WORKSPACE_FILENAME);

  let existing: string | null = null;
  try {
    existing = await fs.promises.readFile(filePath, "utf8");
  } catch {
    // Absent is the common case for apps created before this existed.
  }

  // Nothing to approve for an app that never had a failed install.
  if (existing == null) return { updated: false, skipped: [] };

  const { contents, skipped } = applyBuildApprovals(existing);
  if (contents == null) return { updated: false, skipped };

  await fs.promises.writeFile(filePath, contents, "utf8");
  return { updated: true, skipped };
}
