import { atom } from "jotai";

export type ImportStatus =
  | { state: "importing" }
  | { state: "done" }
  | { state: "error"; message: string };

// These atoms live outside the dialog component so a bulk import keeps
// running (and its progress stays visible) even after the dialog is closed.
export const isImportingDyadAppsAtom = atom<boolean>(false);
export const importDyadAppStatusesAtom = atom<Record<string, ImportStatus>>({});
