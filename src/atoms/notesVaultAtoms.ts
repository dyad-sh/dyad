import { atomWithStorage } from "jotai/utils";

export type VaultNote = {
  id: string;
  title: string;
  body: string;
  pinned: boolean;
  createdAt: number;
  updatedAt: number;
};

/** Plain-text notes stored in Electron's durable renderer storage. */
export const notesVaultAtom = atomWithStorage<VaultNote[]>(
  "meta-human-notes-vault",
  [],
);
