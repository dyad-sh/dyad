import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The indexer pulls in the vector workspace, which reaches for Electron paths
// at import time. Only the file-selection half is under test here.
vi.mock("@/ipc/utils/vector_workspace", () => ({
  createVectorCollection: vi.fn(),
  indexVectorPaths: vi.fn(),
  listVectorCollections: () => [],
  listVectorSources: () => [],
  removeVectorSource: vi.fn(),
  searchVectorWorkspace: vi.fn(),
}));
vi.mock("electron-log", () => ({
  default: { scope: () => ({ warn: vi.fn(), log: vi.fn(), error: vi.fn() }) },
}));

const { indexableMemoryFiles } = await import("@/ipc/utils/memory_index");

let vault: string;

beforeEach(() => {
  vault = fs.mkdtempSync(path.join(os.tmpdir(), "memory-index-"));
  fs.mkdirSync(path.join(vault, "Memory/Projects"), { recursive: true });
  fs.mkdirSync(path.join(vault, "Memory/People"), { recursive: true });
});

afterEach(() => {
  fs.rmSync(vault, { recursive: true, force: true });
});

function write(relative: string, contents: string) {
  const full = path.join(vault, relative);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, contents);
}

const names = (files: string[]) => files.map((file) => path.basename(file));

describe("indexableMemoryFiles", () => {
  it("finds memory Markdown throughout the tree", () => {
    write("Memory/Projects/App.md", "# App\n");
    write("Memory/People/Sam.md", "# Sam\n");
    expect(names(indexableMemoryFiles(vault)).sort()).toEqual([
      "App.md",
      "Sam.md",
    ]);
  });

  it("excludes a file marked do_not_index", () => {
    // The flag must keep it out of the embedding step entirely, not merely
    // filter it later — nothing about it should reach the vector store.
    write("Memory/Projects/App.md", "# App\n");
    write(
      "Memory/Projects/Secret.md",
      "---\ndo_not_index: true\n---\n# Secret\n",
    );
    expect(names(indexableMemoryFiles(vault))).toEqual(["App.md"]);
  });

  it("still indexes a local-only file", () => {
    // Local-only restricts where it may be *sent*, not whether it is
    // searchable on this machine — searching it locally is the point.
    write("Memory/Projects/Private.md", "---\nlocal_only: true\n---\n# P\n");
    expect(names(indexableMemoryFiles(vault))).toEqual(["Private.md"]);
  });

  it("ignores non-Markdown and hidden files", () => {
    write("Memory/Projects/App.md", "# App\n");
    write("Memory/Projects/notes.txt", "text");
    write("Memory/Projects/.hidden.md", "# hidden\n");
    expect(names(indexableMemoryFiles(vault))).toEqual(["App.md"]);
  });

  it("returns nothing when there is no memory folder", () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), "no-memory-"));
    try {
      expect(indexableMemoryFiles(empty)).toEqual([]);
    } finally {
      fs.rmSync(empty, { recursive: true, force: true });
    }
  });

  it("skips an unreadable file rather than failing the whole index", () => {
    write("Memory/Projects/Good.md", "# Good\n");
    fs.mkdirSync(path.join(vault, "Memory/Projects/Broken.md"));
    expect(names(indexableMemoryFiles(vault))).toEqual(["Good.md"]);
  });
});
