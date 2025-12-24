import { atom } from "jotai";
import type { App, Version } from "@/ipc/ipc_types";
import type { UserSettings } from "@/lib/schemas";

export const currentAppAtom = atom<App | null>(null);
export const selectedAppIdAtom = atom<number | null>(null);
export const appsListAtom = atom<App[]>([]);
export const appBasePathAtom = atom<string>("");
export const versionsListAtom = atom<Version[]>([]);
export const previewModeAtom = atom<
  "preview" | "code" | "problems" | "configure" | "publish" | "security"
>("preview");
export const selectedVersionIdAtom = atom<string | null>(null);

export interface ConsoleEntry {
  level: "info" | "warn" | "error";
  type:
    | "server"
    | "client"
    | "edge-function"
    | "network-requests"
    | "build-time";
  message: string;
  timestamp: number;
  sourceName?: string;
  appId: number;
}

export const appConsoleEntriesAtom = atom<ConsoleEntry[]>([]);
export const appUrlAtom = atom<
  | { appUrl: string; appId: number; originalUrl: string }
  | { appUrl: null; appId: null; originalUrl: null }
>({ appUrl: null, appId: null, originalUrl: null });
export const userSettingsAtom = atom<UserSettings | null>(null);

// Atom for storing allow-listed environment variables
export const envVarsAtom = atom<Record<string, string | undefined>>({});

export const previewPanelKeyAtom = atom<number>(0);

export const previewErrorMessageAtom = atom<
  { message: string; source: "preview-app" | "dyad-app" } | undefined
>(undefined);
