/**
 * The shape of the AI's long-term memory inside the File Vault.
 *
 * Markdown is the source of truth: it outlives any database, the user can read
 * and edit it, and it survives this application being uninstalled. The vector
 * store is only an index over it, and can always be rebuilt from these files.
 *
 * Everything here is additive. A vault that already exists gains whatever is
 * missing and loses nothing — the user's own files sit alongside ours.
 */

import fs from "node:fs";
import path from "node:path";

export const MEMORY_ROOT = "Memory";

/** Folders that make up the memory tree, relative to the vault root. */
export const MEMORY_FOLDERS = [
  "Memory",
  "Memory/Conversations",
  "Memory/Summaries",
  "Memory/Long Term Memory",
  "Memory/People",
  "Memory/Projects",
  "Memory/System",
] as const;

/** Long-term memory files and the heading each starts life with. */
const LONG_TERM_FILES: Record<string, string> = {
  "Memory/Long Term Memory/Preferences.md": [
    "# Preferences",
    "",
    "Stable preferences worth carrying into future conversations: preferred",
    "technologies, design and communication style, local versus cloud, and",
    "which models or tools to reach for.",
    "",
  ].join("\n"),
  "Memory/Long Term Memory/Goals.md": [
    "# Goals",
    "",
    "Long-running goals, planned products, and desired outcomes.",
    "",
  ].join("\n"),
  "Memory/Long Term Memory/Important Facts.md": [
    "# Important Facts",
    "",
    "Durable facts likely to stay useful across future conversations.",
    "",
  ].join("\n"),
  "Memory/Long Term Memory/Decisions.md": [
    "# Decisions",
    "",
    "Technical, product, and project decisions, with the reasoning that led",
    "to them and what was considered instead.",
    "",
  ].join("\n"),
  "Memory/Long Term Memory/Timeline.md": [
    "# Timeline",
    "",
    "Meaningful events in chronological order, newest month last.",
    "",
  ].join("\n"),
};

const SYSTEM_FILES: Record<string, string> = {
  "Memory/System/Memory Index.md": [
    "# Memory Index",
    "",
    "Maintained automatically. Editing it by hand is safe — it is rebuilt",
    "from the Markdown files themselves.",
    "",
    "## Conversations",
    "",
    "## Projects",
    "",
    "## People",
    "",
    "## Long-Term Memory",
    "",
    "- Preferences",
    "- Goals",
    "- Important Facts",
    "- Decisions",
    "- Timeline",
    "",
    "## Statistics",
    "",
    "- Total conversations: 0",
    "- Total summaries: 0",
    "- Total project memories: 0",
    "- Total people: 0",
    "- Total indexed chunks: 0",
    "- Last index rebuild: never",
    "",
  ].join("\n"),
  "Memory/System/Memory Rules.md": [
    "# Memory Rules",
    "",
    "What gets remembered, and what deliberately does not.",
    "",
    "## Worth remembering",
    "",
    "- A stable preference",
    "- A project or architecture decision",
    "- An important working relationship",
    "- A long-term goal",
    "- A recurring workflow",
    "- An important date or commitment",
    "- A correction to something already stored",
    "- A completed milestone or a major open task",
    "",
    "## Deliberately not remembered",
    "",
    "- Greetings and pleasantries",
    "- Passing moods",
    "- One-off wording requests and typo fixes",
    "- General knowledge questions",
    "- Ideas floated but not adopted",
    "- Sensitive details with no clear future purpose",
    "",
    "## Privacy flags",
    "",
    "Add any of these to a file's front matter to control how it is used:",
    "",
    "- `local_only: true` — never leaves this machine",
    "- `do_not_index: true` — kept out of the search index entirely",
    "- `do_not_send_to_cloud: true` — usable locally, never sent to a cloud model",
    "",
  ].join("\n"),
  "Memory/System/Retrieval Log.md": [
    "# Retrieval Log",
    "",
    "Contradictions and retrieval problems worth a human's attention.",
    "",
  ].join("\n"),
};

/** Folders the vault should have alongside Memory. */
const COMPANION_FOLDERS = [
  "Projects",
  "Knowledge",
  "Exports",
  "Archive",
] as const;

export type MemoryVaultSetup = {
  createdFolders: string[];
  createdFiles: string[];
};

/**
 * Creates whatever part of the memory tree is missing.
 *
 * Safe to run on every launch: existing folders are left alone and an existing
 * file is never rewritten, so a user's edits to Preferences.md survive.
 */
export async function ensureMemoryVault(
  vaultPath: string,
): Promise<MemoryVaultSetup> {
  const createdFolders: string[] = [];
  const createdFiles: string[] = [];

  for (const folder of [...MEMORY_FOLDERS, ...COMPANION_FOLDERS]) {
    const full = path.join(vaultPath, folder);
    if (!fs.existsSync(full)) {
      await fs.promises.mkdir(full, { recursive: true });
      createdFolders.push(folder);
    }
  }

  for (const [relative, contents] of Object.entries({
    ...LONG_TERM_FILES,
    ...SYSTEM_FILES,
  })) {
    const full = path.join(vaultPath, relative);
    if (fs.existsSync(full)) continue;
    await fs.promises.mkdir(path.dirname(full), { recursive: true });
    // `wx` fails rather than truncating if the file appeared in the meantime.
    try {
      await fs.promises.writeFile(full, contents, { flag: "wx" });
      createdFiles.push(relative);
    } catch {
      // Someone else created it first; their copy wins.
    }
  }

  return { createdFolders, createdFiles };
}

export function memoryPath(vaultPath: string, ...parts: string[]): string {
  return path.join(vaultPath, MEMORY_ROOT, ...parts);
}
