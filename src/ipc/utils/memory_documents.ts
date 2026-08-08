/**
 * Reading and writing memory Markdown.
 *
 * These files are meant to be opened in any editor, so the format stays plain:
 * YAML front matter for the machine, ordinary Markdown for the human. Parsing
 * is deliberately forgiving — a user who hand-edits a file should not be able
 * to break memory by getting the YAML slightly wrong.
 */

export type MemoryFrontMatter = Record<string, string | string[] | boolean>;

export type MemoryDocument = {
  frontMatter: MemoryFrontMatter;
  body: string;
};

const FRONT_MATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

/** Splits a memory file into its front matter and its prose. */
export function parseMemoryDocument(text: string): MemoryDocument {
  const match = text.match(FRONT_MATTER);
  if (!match) return { frontMatter: {}, body: text };

  const frontMatter: MemoryFrontMatter = {};
  let listKey: string | null = null;

  for (const rawLine of match[1]!.split(/\r?\n/)) {
    // A "  - value" line continues the list opened by the previous key.
    const listItem = rawLine.match(/^\s*-\s+(.*)$/);
    if (listItem && listKey) {
      const existing = frontMatter[listKey];
      const value = unquote(listItem[1]!.trim());
      frontMatter[listKey] = Array.isArray(existing)
        ? [...existing, value]
        : [value];
      continue;
    }

    const pair = rawLine.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!pair) continue;
    const [, key, rawValue] = pair;
    const value = rawValue!.trim();

    if (value === "") {
      // Either an empty value or the start of a list on following lines.
      listKey = key!;
      frontMatter[key!] = [];
      continue;
    }
    listKey = null;

    if (value === "true" || value === "false") {
      frontMatter[key!] = value === "true";
    } else if (value.startsWith("[") && value.endsWith("]")) {
      const inner = value.slice(1, -1).trim();
      frontMatter[key!] = inner
        ? inner.split(",").map((part) => unquote(part.trim()))
        : [];
    } else {
      frontMatter[key!] = unquote(value);
    }
  }

  return { frontMatter, body: text.slice(match[0].length) };
}

function unquote(value: string): string {
  return value.replace(/^["'](.*)["']$/, "$1");
}

/** Renders front matter + body back to a file's contents. */
export function serialiseMemoryDocument(document: MemoryDocument): string {
  const lines: string[] = ["---"];
  for (const [key, value] of Object.entries(document.frontMatter)) {
    if (Array.isArray(value)) {
      if (value.length === 0) {
        lines.push(`${key}: []`);
      } else {
        lines.push(`${key}:`);
        for (const item of value) lines.push(`  - ${item}`);
      }
    } else {
      lines.push(`${key}: ${value}`);
    }
  }
  lines.push("---", "");
  return `${lines.join("\n")}${document.body.replace(/^\n+/, "")}`;
}

// ── Privacy ────────────────────────────────────────────────────────────────

export type PrivacyFlags = {
  /** Never leaves this machine, for any purpose. */
  localOnly: boolean;
  /** Kept out of the search index entirely. */
  doNotIndex: boolean;
  /** Searchable locally, but never included in a prompt to a cloud model. */
  doNotSendToCloud: boolean;
};

export function readPrivacyFlags(frontMatter: MemoryFrontMatter): PrivacyFlags {
  const flag = (key: string) => frontMatter[key] === true;
  const localOnly = flag("local_only");
  return {
    localOnly,
    // "Local only" implies the narrower restrictions; stating one should not
    // require remembering to state the others.
    doNotIndex: flag("do_not_index"),
    doNotSendToCloud: localOnly || flag("do_not_send_to_cloud"),
  };
}

/** Whether a memory file may be indexed at all. */
export function mayIndex(frontMatter: MemoryFrontMatter): boolean {
  return !readPrivacyFlags(frontMatter).doNotIndex;
}

/** Whether a memory may be sent to a model running outside this machine. */
export function maySendToCloud(frontMatter: MemoryFrontMatter): boolean {
  return !readPrivacyFlags(frontMatter).doNotSendToCloud;
}

// ── Conversation files ─────────────────────────────────────────────────────

/** `2026-08-04_15-20_title.md`, sortable and readable in a file listing. */
export function conversationFileName(when: Date, title: string): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  const stamp =
    `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}` +
    `_${pad(when.getHours())}-${pad(when.getMinutes())}`;
  return `${stamp}_${slugify(title)}.md`;
}

export function slugify(title: string): string {
  return (
    title
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "conversation"
  );
}

export type ConversationTurn = { role: "user" | "assistant"; content: string };

export function conversationHeader(meta: {
  id: string;
  title: string;
  created: string;
  updated: string;
  project?: string | null;
  tags?: string[];
}): string {
  return serialiseMemoryDocument({
    frontMatter: {
      id: meta.id,
      type: "conversation",
      created: meta.created,
      updated: meta.updated,
      title: meta.title,
      project: meta.project ?? "null",
      participants: ["user", "assistant"],
      tags: meta.tags ?? [],
    },
    body: `# ${meta.title}\n`,
  });
}

/** One turn, in the heading-per-speaker form the spec asks for. */
export function renderTurn(turn: ConversationTurn): string {
  const speaker = turn.role === "user" ? "User" : "Assistant";
  return `\n## ${speaker}\n\n${turn.content.trim()}\n`;
}

/**
 * The turns not yet written to a file.
 *
 * Appending is safer than rewriting — a crash mid-write cannot lose earlier
 * turns — but it needs to know where it left off. Comparing against what the
 * file already holds keeps a retry or a double-save from duplicating text.
 */
export function turnsToAppend(
  existing: string,
  turns: ConversationTurn[],
): ConversationTurn[] {
  // Walk forward through the file matching turns in order. Searching from the
  // previous match rather than the start is what lets a conversation repeat a
  // message ("ok" twice) without the second one being mistaken for the first.
  let cursor = 0;
  let matched = 0;

  for (const turn of turns) {
    const rendered = renderTurn(turn);
    const at = existing.indexOf(rendered, cursor);
    if (at < 0) break;
    cursor = at + rendered.length;
    matched += 1;
  }

  return turns.slice(matched);
}
