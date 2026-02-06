import { atom } from "jotai";
import type { App, Version, ConsoleEntry } from "@/ipc/types";
import type { UserSettings } from "@/lib/schemas";

export const currentAppAtom = atom<App | null>(null);
export const selectedAppIdAtom = atom<number | null>(null);
export const versionsListAtom = atom<Version[]>([]);
export const previewModeAtom = atom<
  | "preview"
  | "code"
  | "problems"
  | "configure"
  | "publish"
  | "security"
  | "plan"
>("preview");
export const selectedVersionIdAtom = atom<string | null>(null);

export const appConsoleEntriesAtom = atom<ConsoleEntry[]>([]);
export const appUrlAtom = atom<
  | { appUrl: string; appId: number; originalUrl: string }
  | { appUrl: null; appId: null; originalUrl: null }
>({ appUrl: null, appId: null, originalUrl: null });
export const userSettingsAtom = atom<UserSettings | null>(null);

// Atom for storing allow-listed environment variables
export const envVarsAtom = atom<Record<string, string | undefined>>({});

export const previewPanelKeyAtom = atom<number>(0);

// Stores the current preview URL to preserve route across HMR-induced remounts
// Maps appId to the current URL for that app
export const previewCurrentUrlAtom = atom<Record<number, string>>({});

export const previewErrorMessageAtom = atom<
  { message: string; source: "preview-app" | "dyad-app" } | undefined
>(undefined);
