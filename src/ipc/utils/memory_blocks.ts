/**
 * Managed blocks inside otherwise hand-written Markdown.
 *
 * These files belong to the user. They will open Preferences.md, add their own
 * headings, correct our wording, and delete things they disagree with — and
 * all of that has to survive the next extraction. So the machine never
 * rewrites a file: it owns only the regions between its own HTML comments and
 * treats every other byte as untouchable.
 *
 * The comments are invisible in rendered Markdown and in Obsidian, so the file
 * still reads as prose.
 */

export type ManagedItem = {
  id: string;
  title: string;
  content: string;
  sourceConversation: string;
  sourceMessage: string;
  created: string;
  lastConfirmed: string;
  confidence: number;
  authority: string;
  status: "active" | "superseded" | "deleted";
  supersedes?: string;
  supersededBy?: string;
  tags?: string[];
};

const START = (id: string) => `<!-- memory:${id}:start -->`;
const END = (id: string) => `<!-- memory:${id}:end -->`;

/** Matches any managed block, capturing its id and body. */
const BLOCK_PATTERN =
  /<!-- memory:([^:]+):start -->([\s\S]*?)<!-- memory:\1:end -->/g;

export function renderBlock(item: ManagedItem): string {
  const lines = [
    START(item.id),
    `## ${item.title}`,
    "",
    `- ID: ${item.id}`,
    `- Content: ${item.content}`,
    `- Source conversation: ${item.sourceConversation}`,
    `- Source message: ${item.sourceMessage}`,
    `- Created: ${item.created}`,
    `- Last confirmed: ${item.lastConfirmed}`,
    `- Confidence: ${item.confidence}`,
    `- Authority: ${item.authority}`,
    `- Status: ${item.status}`,
  ];
  if (item.supersedes) lines.push(`- Supersedes: ${item.supersedes}`);
  if (item.supersededBy) lines.push(`- Superseded by: ${item.supersededBy}`);
  lines.push(`- Tags: ${(item.tags ?? []).join(", ")}`);
  lines.push(END(item.id));
  return lines.join("\n");
}

/** The ids of every managed block in a document, in order. */
export function listBlockIds(document: string): string[] {
  const ids: string[] = [];
  for (const match of document.matchAll(BLOCK_PATTERN)) {
    ids.push(match[1]!);
  }
  return ids;
}

export function hasBlock(document: string, id: string): boolean {
  return document.includes(START(id)) && document.includes(END(id));
}

/** Reads one field back out of a managed block. */
export function readBlockField(
  document: string,
  id: string,
  field: string,
): string | null {
  const block = extractBlock(document, id);
  if (!block) return null;
  const match = block.match(
    new RegExp(`^- ${escapeRegex(field)}:\\s*(.*)$`, "m"),
  );
  return match ? match[1]!.trim() : null;
}

function extractBlock(document: string, id: string): string | null {
  const start = document.indexOf(START(id));
  if (start < 0) return null;
  const end = document.indexOf(END(id), start);
  if (end < 0) return null;
  return document.slice(start, end + END(id).length);
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Inserts or replaces one block, leaving everything else byte-for-byte.
 *
 * Appending is the only structural change ever made to a file we did not
 * write, so a user's own headings and notes keep their position.
 */
export function upsertBlock(document: string, item: ManagedItem): string {
  const rendered = renderBlock(item);
  const existing = extractBlock(document, item.id);

  if (existing) {
    return document.replace(existing, rendered);
  }

  const separator = document.endsWith("\n\n")
    ? ""
    : document.endsWith("\n")
      ? "\n"
      : "\n\n";
  return `${document}${separator}${rendered}\n`;
}

/**
 * Removes a block entirely, along with the blank line it introduced.
 *
 * Used for forgetting: the content has to leave the source of truth, not merely
 * be marked deleted, or it would still be readable in the file.
 */
export function removeBlock(document: string, id: string): string {
  const block = extractBlock(document, id);
  if (!block) return document;
  const withoutBlock = document.replace(block, "");
  // Collapse the gap left behind so the file does not accumulate blank space.
  return withoutBlock.replace(/\n{3,}/g, "\n\n");
}

/** Marks a block superseded and points at what replaced it. */
export function supersedeBlock(
  document: string,
  id: string,
  replacementId: string,
): string {
  const block = extractBlock(document, id);
  if (!block) return document;
  let updated = block.replace(/^- Status: .*$/m, "- Status: superseded");
  updated = /^- Superseded by: /m.test(updated)
    ? updated.replace(
        /^- Superseded by: .*$/m,
        `- Superseded by: ${replacementId}`,
      )
    : updated.replace(
        /^- Status: superseded$/m,
        `- Status: superseded\n- Superseded by: ${replacementId}`,
      );
  return document.replace(block, updated);
}

/** Every active item's id — what retrieval and counting should consider. */
export function activeBlockIds(document: string): string[] {
  return listBlockIds(document).filter(
    (id) => readBlockField(document, id, "Status") === "active",
  );
}

/**
 * A stable id for an item, so the same statement updates its block rather than
 * appending a near-duplicate on every run.
 */
export function stableItemId(
  category: string,
  statement: string,
  hash: (value: string) => string,
): string {
  return `${category}-${hash(statement.trim().toLowerCase()).slice(0, 12)}`;
}
