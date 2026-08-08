/**
 * Shared reader/writer for the Markdown files the app keeps in the vault.
 *
 * Everything written into the vault is plain Markdown with a YAML frontmatter
 * block, so the files stay portable (Obsidian, any editor) while remaining
 * machine-readable. This module is the single place that knows that format,
 * so what the app writes it can always read back.
 */

export interface MarkdownDocument {
  /** Parsed frontmatter keys. Values stay as strings or string arrays. */
  frontmatter: Record<string, string | string[]>;
  /** Document body with the frontmatter block removed. */
  body: string;
  /** First `# ` heading in the body, or the frontmatter title. */
  title: string | null;
}

const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

/** Quote a YAML scalar only when it needs it. */
export function yamlScalar(value: string): string {
  const trimmed = value.trim();
  if (trimmed === "") return '""';
  if (/^[\w .@/-]+$/.test(trimmed) && !/^\d+$/.test(trimmed)) {
    return trimmed;
  }
  return `"${trimmed.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/**
 * Build a Markdown document with a frontmatter block. Keys with an array
 * value become YAML lists; empty values are omitted so the block stays clean.
 */
export function buildMarkdownDocument(input: {
  frontmatter: Record<string, string | string[] | number | undefined | null>;
  body: string;
}): string {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(input.frontmatter)) {
    if (value === undefined || value === null || value === "") continue;
    if (Array.isArray(value)) {
      if (value.length === 0) continue;
      lines.push(`${key}:`);
      for (const entry of value) lines.push(`  - ${yamlScalar(String(entry))}`);
    } else {
      lines.push(`${key}: ${yamlScalar(String(value))}`);
    }
  }
  const body = input.body.replace(/\s+$/, "");
  if (lines.length === 0) return `${body}\n`;
  return `---\n${lines.join("\n")}\n---\n\n${body}\n`;
}

/**
 * Parse a Markdown file into frontmatter and body.
 *
 * Deliberately lenient: a malformed or absent frontmatter block yields empty
 * frontmatter and the original text as the body, so a hand-edited file never
 * breaks indexing or reading.
 */
export function parseMarkdownDocument(raw: string): MarkdownDocument {
  const withoutBom = raw.replace(/^﻿/, "");
  const match = FRONTMATTER_PATTERN.exec(withoutBom);

  let frontmatter: Record<string, string | string[]> = {};
  let body = withoutBom;

  if (match) {
    body = withoutBom.slice(match[0].length);
    frontmatter = parseFrontmatterBlock(match[1]);
  }

  const headingMatch = /^#\s+(.+)$/m.exec(body);
  const frontmatterTitle = frontmatter.title;
  const title =
    headingMatch?.[1].trim() ??
    (typeof frontmatterTitle === "string" ? frontmatterTitle : null);

  return { frontmatter, body: body.trim(), title };
}

function parseFrontmatterBlock(
  block: string,
): Record<string, string | string[]> {
  const result: Record<string, string | string[]> = {};
  let currentListKey: string | null = null;

  for (const rawLine of block.split(/\r?\n/)) {
    const listItem = /^\s+-\s+(.*)$/.exec(rawLine);
    if (listItem && currentListKey) {
      const existing = result[currentListKey];
      const value = unquote(listItem[1]);
      result[currentListKey] = Array.isArray(existing)
        ? [...existing, value]
        : [value];
      continue;
    }

    const pair = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(rawLine);
    if (!pair) continue;
    const [, key, value] = pair;
    if (value.trim() === "") {
      // Start of a list block; the value arrives on following lines.
      currentListKey = key;
      result[key] = [];
    } else {
      currentListKey = null;
      result[key] = unquote(value);
    }
  }

  return result;
}

function unquote(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length > 1) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'") && trimmed.length > 1)
  ) {
    return trimmed.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  }
  return trimmed;
}

/**
 * Text worth embedding for retrieval: the body without the YAML block, with
 * the title kept so a document is findable by name.
 */
export function markdownIndexableText(raw: string): string {
  const { body, title, frontmatter } = parseMarkdownDocument(raw);
  const tags = frontmatter.tags;
  const tagLine = Array.isArray(tags) && tags.length > 0 ? tags.join(" ") : "";
  return [title ?? "", tagLine, body].filter(Boolean).join("\n\n").trim();
}
