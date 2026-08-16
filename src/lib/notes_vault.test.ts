import { describe, expect, it, vi } from "vitest";

import type { VaultNote } from "@/atoms/notesVaultAtoms";
import {
  createVaultNote,
  noteDisplayTitle,
  searchVaultNotes,
  sortVaultNotes,
} from "./notes_vault";

function note(patch: Partial<VaultNote>): VaultNote {
  return {
    id: patch.id ?? crypto.randomUUID(),
    title: "",
    body: "",
    pinned: false,
    createdAt: 1,
    updatedAt: 1,
    ...patch,
  };
}

describe("Notes Vault", () => {
  it("creates an empty durable note record", () => {
    vi.spyOn(crypto, "randomUUID").mockReturnValue(
      "00000000-0000-4000-8000-000000000001",
    );
    expect(createVaultNote(123)).toEqual({
      id: "00000000-0000-4000-8000-000000000001",
      title: "",
      body: "",
      pinned: false,
      createdAt: 123,
      updatedAt: 123,
    });
  });

  it("derives an untitled note label from its first line", () => {
    expect(noteDisplayTitle(note({ body: "First useful thought\nMore" }))).toBe(
      "First useful thought",
    );
  });

  it("keeps pinned notes first and searches title plus body", () => {
    const notes = [
      note({ id: "old", title: "Shopping", updatedAt: 2 }),
      note({ id: "new", body: "Guitar setup", updatedAt: 5 }),
      note({ id: "pin", title: "Ideas", pinned: true, updatedAt: 1 }),
    ];
    expect(sortVaultNotes(notes).map((item) => item.id)).toEqual([
      "pin",
      "new",
      "old",
    ]);
    expect(searchVaultNotes(notes, "guitar").map((item) => item.id)).toEqual([
      "new",
    ]);
  });
});
