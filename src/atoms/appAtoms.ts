import type { App, AppOutput, Version } from "@/ipc/ipc_types";
import type { UserSettings } from "@/lib/schemas";
import { atom } from "jotai";
import {
  SYSTEM_MESSAGES_SESSION_ID,
  SYSTEM_MESSAGES_TAB_ID,
  activeTerminalIdAtom,
  createSystemMessagesSession,
  createSystemMessagesTab,
  terminalSessionsAtom,
  terminalTabsAtom,
} from "./terminalAtoms";
import type { TerminalSession } from "./terminalAtoms";

export const currentAppAtom = atom<App | null>(null);
export const selectedAppIdAtom = atom<number | null>(null);
export const appsListAtom = atom<App[]>([]);
export const appBasePathAtom = atom<string>("");
export const versionsListAtom = atom<Version[]>([]);
export const previewModeAtom = atom<
  "preview" | "code" | "problems" | "configure" | "publish" | "security"
>("preview");
export const selectedVersionIdAtom = atom<string | null>(null);
type AppOutputUpdate =
  | AppOutput[]
  | ((prev: AppOutput[]) => AppOutput[]);

export const appOutputAtom = atom<AppOutput[], AppOutputUpdate>(
  (get) => {
    const sessions = get(terminalSessionsAtom);
    const systemSession = sessions.get(SYSTEM_MESSAGES_SESSION_ID);
    return systemSession?.output ?? [];
  },
  (get, set, update) => {
    const sessions = get(terminalSessionsAtom);
    const existingSystemSession =
      sessions.get(SYSTEM_MESSAGES_SESSION_ID) ??
      createSystemMessagesSession();
    const previousOutput = existingSystemSession.output;
    const nextOutput =
      typeof update === "function" ? update(previousOutput) : update;

    const activeId = get(activeTerminalIdAtom);
    if (!activeId) {
      set(activeTerminalIdAtom, SYSTEM_MESSAGES_SESSION_ID);
    }
    const resolvedActiveId = activeId ?? SYSTEM_MESSAGES_SESSION_ID;
    const isActive = resolvedActiveId === SYSTEM_MESSAGES_SESSION_ID;
    const nextLastActivity =
      nextOutput.length > 0
        ? nextOutput[nextOutput.length - 1]?.timestamp ?? Date.now()
        : existingSystemSession.lastActivity;

    const updatedSystemSession: TerminalSession = {
      ...existingSystemSession,
      output: nextOutput,
      isActive: isActive ? true : existingSystemSession.isActive,
      lastActivity: nextLastActivity,
    };

    set(terminalSessionsAtom, (prevSessions) => {
      const nextSessions = new Map(prevSessions);
      nextSessions.set(SYSTEM_MESSAGES_SESSION_ID, updatedSystemSession);
      return nextSessions;
    });

    set(terminalTabsAtom, (prevTabs) => {
      const hasSystemTab = prevTabs.some(
        (tab) => tab.id === SYSTEM_MESSAGES_TAB_ID,
      );
      const hasNewOutput = nextOutput.length > previousOutput.length;

      if (!hasSystemTab) {
        const systemTab = {
          ...createSystemMessagesTab(),
          isActive,
          hasUnreadOutput: !isActive && hasNewOutput,
        };
        return [systemTab, ...prevTabs];
      }

      return prevTabs.map((tab) =>
        tab.id === SYSTEM_MESSAGES_TAB_ID
          ? {
              ...tab,
              isActive,
              hasUnreadOutput: !isActive && hasNewOutput,
            }
          : tab
      );
    });
  },
);
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
