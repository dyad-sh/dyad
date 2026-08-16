import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { VaultNote } from "@/ipc/types/storage";
import {
  syncVaultNotesToLocal,
  vaultNoteFileName,
  vaultNoteMarkdown,
} from "@/ipc/utils/vault_notes";

const temporaryDirectories: string[] = [];

function note(overrides: Partial<VaultNote> = {}): VaultNote {
  return {
    id: "note-123",
    title: "Red Special setup",
    body: "Check the tremolo and pickup switches.",
    pinned: true,
    createdAt: Date.parse("2026-08-17T00:00:00.000Z"),
    updatedAt: Date.parse("2026-08-17T01:00:00.000Z"),
    ...overrides,
  };
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) =>
        fs.promises.rm(directory, { recursive: true, force: true }),
      ),
  );
});

describe("Notes Vault Markdown mirror", () => {
  it("writes portable front matter and readable Markdown", () => {
    const markdown = vaultNoteMarkdown(note());

    expect(markdown).toContain("source: notes-vault");
    expect(markdown).toContain('note_id: "note-123"');
    expect(markdown).toContain("pinned: true");
    expect(markdown).toContain("# Red Special setup");
    expect(markdown).toContain("Check the tremolo and pickup switches.");
  });

  it("renames and removes managed notes without touching user files", async () => {
    const vault = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), "meta-human-notes-vault-"),
    );
    temporaryDirectories.push(vault);
    const original = note();
    const notesDirectory = path.join(vault, "Notes", "Vault");

    await syncVaultNotesToLocal(vault, [original]);
    const originalPath = path.join(notesDirectory, vaultNoteFileName(original));
    expect(fs.existsSync(originalPath)).toBe(true);

    const userFile = path.join(notesDirectory, "My handwritten note.md");
    await fs.promises.writeFile(userFile, "Do not remove me", "utf8");
    const renamed = note({ title: "Updated setup" });
    await syncVaultNotesToLocal(vault, [renamed]);

    expect(fs.existsSync(originalPath)).toBe(false);
    expect(
      fs.existsSync(path.join(notesDirectory, vaultNoteFileName(renamed))),
    ).toBe(true);
    expect(fs.existsSync(userFile)).toBe(true);

    const userOwnedManagedName = path.join(
      notesDirectory,
      vaultNoteFileName(note({ id: "manual-note", title: "Manual" })),
    );
    await fs.promises.writeFile(
      userOwnedManagedName,
      "A user-owned file without Notes Vault metadata.",
      "utf8",
    );
    await syncVaultNotesToLocal(vault, []);
    expect(fs.existsSync(userFile)).toBe(true);
    expect(fs.existsSync(userOwnedManagedName)).toBe(true);
    expect(
      fs.existsSync(path.join(notesDirectory, vaultNoteFileName(renamed))),
    ).toBe(false);
  });
});
