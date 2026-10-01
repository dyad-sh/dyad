import type { OllamaRegistryModel } from "../types/language-model";

const TABLE_COLUMNS = ["MODEL", "UPDATED", "CONTEXT", "SIZE"] as const;

/**
 * Parses the fixed-width table `ola-remote -a <term>` prints:
 *
 *   MODEL                     UPDATED      CONTEXT         SIZE
 *   qwen3-coder:30b           2025/09/23   256K            19GB
 *
 * Rows are sliced at the header's column offsets rather than split on
 * whitespace, so a blank cell cannot shift the columns after it. `N/A` (the
 * tool's marker for an unknown value) and empty cells become `null`.
 */
export function parseOlaRemoteTable(output: string): OllamaRegistryModel[] {
  const lines = output.split(/\r?\n/);
  const headerIndex = lines.findIndex((line) =>
    TABLE_COLUMNS.every((column) => line.includes(column)),
  );
  if (headerIndex === -1) return [];

  const header = lines[headerIndex];
  const offsets = TABLE_COLUMNS.map((column) => header.indexOf(column));
  const orNull = (value: string): string | null =>
    value === "" || value === "N/A" ? null : value;

  const models: OllamaRegistryModel[] = [];
  for (const line of lines.slice(headerIndex + 1)) {
    // Model names never contain spaces. A name longer than the MODEL column
    // pushes the rest of its row right (older ola-remote builds did not widen
    // the column), so the other cells are sliced past that overflow.
    const name = line.match(/^\S+/)?.[0];
    if (!name) continue;
    const shift = Math.max(0, name.length + 1 - offsets[1]);
    const cell = (column: number): string | null => {
      const start = offsets[column] + shift;
      const end =
        column + 1 < offsets.length ? offsets[column + 1] + shift : undefined;
      return orNull(line.slice(start, end).trim());
    };
    models.push({
      name,
      updated: cell(1),
      context: cell(2),
      size: cell(3),
    });
  }
  return models;
}

/**
 * Splits a newline-delimited JSON byte stream into parsed objects. Chunks can
 * end mid-line, so the trailing partial line is kept until the next chunk (or
 * `flush`) completes it.
 */
export function createNdjsonParser() {
  const decoder = new TextDecoder();
  let pending = "";

  const parseLines = (text: string): unknown[] =>
    text
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line !== "")
      .map((line) => JSON.parse(line));

  return {
    push(chunk: Uint8Array): unknown[] {
      pending += decoder.decode(chunk, { stream: true });
      const lastNewline = pending.lastIndexOf("\n");
      if (lastNewline === -1) return [];
      const complete = pending.slice(0, lastNewline);
      pending = pending.slice(lastNewline + 1);
      return parseLines(complete);
    },
    flush(): unknown[] {
      const rest = pending + decoder.decode();
      pending = "";
      return parseLines(rest);
    },
  };
}
