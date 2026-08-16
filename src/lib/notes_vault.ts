import type { VaultNote } from "@/atoms/notesVaultAtoms";

export function noteDisplayTitle(note: VaultNote): string {
  const title = note.title.trim();
  if (title) return title;
  return note.body.trim().split(/\r?\n/, 1)[0]?.slice(0, 60) || "Untitled note";
}

export function sortVaultNotes(notes: VaultNote[]): VaultNote[] {
  return [...notes].sort(
    (a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt,
  );
}

export function searchVaultNotes(
  notes: VaultNote[],
  query: string,
): VaultNote[] {
  const needle = query.trim().toLocaleLowerCase();
  const sorted = sortVaultNotes(notes);
  if (!needle) return sorted;
  return sorted.filter((note) =>
    `${note.title}\n${note.body}`.toLocaleLowerCase().includes(needle),
  );
}

export function createVaultNote(now = Date.now()): VaultNote {
  return {
    id: crypto.randomUUID(),
    title: "",
    body: "",
    pinned: false,
    createdAt: now,
    updatedAt: now,
  };
}
