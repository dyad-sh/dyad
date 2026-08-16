import { atomWithStorage } from "jotai/utils";
import type { VaultNote } from "@/ipc/types/storage";

export type { VaultNote } from "@/ipc/types/storage";

/** Plain-text notes stored in Electron's durable renderer storage. */
export const notesVaultAtom = atomWithStorage<VaultNote[]>(
  "meta-human-notes-vault",
  [],
);
