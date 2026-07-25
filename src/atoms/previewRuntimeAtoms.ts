import { atom } from "jotai";
import type { ConsoleEntry } from "@/ipc/types";
import { selectedAppIdAtom } from "@/atoms/appAtoms";
import { createPreviewConsoleTail } from "@/lib/preview_console_buffer";

export interface PreviewErrorMessage {
  message: string;
  source: "preview-app" | "dyad-app" | "dyad-sync";
}

export type PackageManagerWarningKind = "release-age" | "pnpm-migration";

export interface PackageManagerWarning {
  kind: PackageManagerWarningKind;
  message: string;
  appId: number;
}

const packageManagerWarningPriority: Record<PackageManagerWarningKind, number> =
  {
    "pnpm-migration": 1,
    "release-age": 2,
  };

export type PreviewErrorUpdate =
  | PreviewErrorMessage
  | undefined
  | ((
      current: PreviewErrorMessage | undefined,
    ) => PreviewErrorMessage | undefined);

export const previewErrorByAppIdAtom = atom<Map<number, PreviewErrorMessage>>(
  new Map(),
);
export const consoleEntriesByAppIdAtom = atom<Map<number, ConsoleEntry[]>>(
  new Map(),
);
export const packageManagerWarningByAppIdAtom = atom<
  Map<number, Omit<PackageManagerWarning, "appId">>
>(new Map());
export const dismissedPackageManagerWarningAppIdsAtom = atom<Set<number>>(
  new Set<number>(),
);

export const currentPreviewErrorAtom = atom((get) => {
  const appId = get(selectedAppIdAtom);
  return appId === null ? undefined : get(previewErrorByAppIdAtom).get(appId);
});

export const currentConsoleEntriesAtom = atom((get) => {
  const appId = get(selectedAppIdAtom);
  return appId === null
    ? []
    : (get(consoleEntriesByAppIdAtom).get(appId) ?? []);
});

export const currentPackageManagerWarningAtom = atom(
  (get): PackageManagerWarning | undefined => {
    const appId = get(selectedAppIdAtom);
    if (appId === null) {
      return undefined;
    }
    const warning = get(packageManagerWarningByAppIdAtom).get(appId);
    return warning === undefined ? undefined : { ...warning, appId };
  },
);

export const setPreviewErrorForAppAtom = atom(
  null,
  (
    _get,
    set,
    { appId, error }: { appId: number; error: PreviewErrorUpdate },
  ) => {
    set(previewErrorByAppIdAtom, (prev) => {
      const current = prev.get(appId);
      const nextError = typeof error === "function" ? error(current) : error;
      const next = new Map(prev);
      if (nextError) {
        next.set(appId, nextError);
      } else {
        next.delete(appId);
      }
      return next;
    });
  },
);

export const setConsoleEntriesForAppAtom = atom(
  null,
  (
    _get,
    set,
    { appId, entries }: { appId: number; entries: ConsoleEntry[] },
  ) => {
    set(consoleEntriesByAppIdAtom, (prev) => {
      const next = new Map(prev);
      if (entries.length === 0) {
        next.delete(appId);
      } else {
        next.set(appId, createPreviewConsoleTail(appId, [], entries));
      }
      return next;
    });
  },
);

export const appendConsoleEntriesForAppAtom = atom(
  null,
  (
    _get,
    set,
    { appId, entries }: { appId: number; entries: ConsoleEntry[] },
  ) => {
    if (entries.length === 0) {
      return;
    }
    set(consoleEntriesByAppIdAtom, (prev) => {
      const next = new Map(prev);
      next.set(
        appId,
        createPreviewConsoleTail(appId, next.get(appId) ?? [], entries),
      );
      return next;
    });
  },
);

export const setPackageManagerWarningForAppAtom = atom(
  null,
  (
    get,
    set,
    {
      appId,
      warning,
    }: { appId: number; warning: Omit<PackageManagerWarning, "appId"> },
  ) => {
    if (get(dismissedPackageManagerWarningAppIdsAtom).has(appId)) {
      return;
    }

    set(packageManagerWarningByAppIdAtom, (prev) => {
      const current = prev.get(appId);
      if (
        current &&
        packageManagerWarningPriority[current.kind] >
          packageManagerWarningPriority[warning.kind]
      ) {
        return prev;
      }
      const next = new Map(prev);
      next.set(appId, warning);
      return next;
    });
  },
);

export const dismissPackageManagerWarningsAtom = atom(
  null,
  (get, set, appId: number) => {
    const dismissedAppIds = get(dismissedPackageManagerWarningAppIdsAtom);
    const nextDismissedAppIds = new Set(dismissedAppIds);
    nextDismissedAppIds.add(appId);
    set(dismissedPackageManagerWarningAppIdsAtom, nextDismissedAppIds);
    set(packageManagerWarningByAppIdAtom, (prev) => {
      const next = new Map(prev);
      next.delete(appId);
      return next;
    });
  },
);

export const clearPackageManagerWarningForAppAtom = atom(
  null,
  (_get, set, appId: number) => {
    set(packageManagerWarningByAppIdAtom, (prev) => {
      const next = new Map(prev);
      next.delete(appId);
      return next;
    });
  },
);

export const clearPreviewRuntimeForAppAtom = atom(
  null,
  (_get, set, appId: number) => {
    set(previewErrorByAppIdAtom, (prev) => {
      const next = new Map(prev);
      next.delete(appId);
      return next;
    });
    set(consoleEntriesByAppIdAtom, (prev) => {
      const next = new Map(prev);
      next.delete(appId);
      return next;
    });
    set(packageManagerWarningByAppIdAtom, (prev) => {
      const next = new Map(prev);
      next.delete(appId);
      return next;
    });
  },
);
