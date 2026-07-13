import { atom } from "jotai";
import type { ConsoleEntry } from "@/ipc/types";
import type { RuntimeMode2 } from "@/lib/schemas";
import { selectedAppIdAtom } from "@/atoms/appAtoms";
import { createPreviewConsoleTail } from "@/lib/preview_console_buffer";

export type AppUrlState =
  | {
      appUrl: string;
      appId: number;
      originalUrl: string;
      mode: RuntimeMode2;
    }
  | {
      appUrl: null;
      appId: null;
      originalUrl: null;
      mode: null;
    };

export const EMPTY_APP_URL: AppUrlState = {
  appUrl: null,
  appId: null,
  originalUrl: null,
  mode: null,
};

export type PreviewRunOperation = "run" | "restart" | "stop";

export interface PreviewRunState {
  operation: PreviewRunOperation;
  startedAt: number;
}

export interface PreviewAppExit {
  appId: number;
  exitCode: number | null;
  timestamp: number;
}

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

export const previewRunStateByAppIdAtom = atom<Map<number, PreviewRunState>>(
  new Map(),
);
export const previewErrorByAppIdAtom = atom<Map<number, PreviewErrorMessage>>(
  new Map(),
);
export const previewAppExitByAppIdAtom = atom<Map<number, PreviewAppExit>>(
  new Map(),
);
export const appUrlByAppIdAtom = atom<Map<number, AppUrlState>>(new Map());
export const previewReloadTokenByAppIdAtom = atom<Map<number, number>>(
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

// Stores the current preview URL to preserve route across HMR-induced remounts.
// This tracks the current iframe route per app, not the app's base URL.
export const previewCurrentUrlAtom = atom<Map<number, string>>(new Map());

export const currentPreviewRunStateAtom = atom((get) => {
  const appId = get(selectedAppIdAtom);
  return appId === null
    ? undefined
    : get(previewRunStateByAppIdAtom).get(appId);
});

export const currentPreviewLoadingAtom = atom(
  (get) => get(currentPreviewRunStateAtom) !== undefined,
);

export const currentPreviewRunStartedAtAtom = atom(
  (get) => get(currentPreviewRunStateAtom)?.startedAt ?? null,
);

export const currentPreviewErrorAtom = atom((get) => {
  const appId = get(selectedAppIdAtom);
  return appId === null ? undefined : get(previewErrorByAppIdAtom).get(appId);
});

export const currentPreviewAppExitAtom = atom((get) => {
  const appId = get(selectedAppIdAtom);
  return appId === null
    ? null
    : (get(previewAppExitByAppIdAtom).get(appId) ?? null);
});

export const currentAppUrlAtom = atom((get) => {
  const appId = get(selectedAppIdAtom);
  return appId === null
    ? EMPTY_APP_URL
    : (get(appUrlByAppIdAtom).get(appId) ?? EMPTY_APP_URL);
});

export const currentPreviewReloadTokenAtom = atom((get) => {
  const appId = get(selectedAppIdAtom);
  return appId === null
    ? 0
    : (get(previewReloadTokenByAppIdAtom).get(appId) ?? 0);
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

export const setPreviewRunStateForAppAtom = atom(
  null,
  (
    _get,
    set,
    { appId, state }: { appId: number; state: PreviewRunState | undefined },
  ) => {
    set(previewRunStateByAppIdAtom, (prev) => {
      const next = new Map(prev);
      if (state) {
        next.set(appId, state);
      } else {
        next.delete(appId);
      }
      return next;
    });
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

export const setPreviewAppExitForAppAtom = atom(
  null,
  (
    _get,
    set,
    { appId, exit }: { appId: number; exit: PreviewAppExit | null },
  ) => {
    set(previewAppExitByAppIdAtom, (prev) => {
      const next = new Map(prev);
      if (exit) {
        next.set(appId, exit);
      } else {
        next.delete(appId);
      }
      return next;
    });
  },
);

export const setAppUrlForAppAtom = atom(
  null,
  (_get, set, { appId, appUrl }: { appId: number; appUrl: AppUrlState }) => {
    set(appUrlByAppIdAtom, (prev) => {
      const next = new Map(prev);
      if (appUrl.appUrl === null) {
        next.delete(appId);
      } else {
        next.set(appId, appUrl);
      }
      return next;
    });
  },
);

export const bumpPreviewReloadTokenForAppAtom = atom(
  null,
  (_get, set, appId: number) => {
    set(previewReloadTokenByAppIdAtom, (prev) => {
      const next = new Map(prev);
      next.set(appId, (next.get(appId) ?? 0) + 1);
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
    set(previewRunStateByAppIdAtom, (prev) => {
      const next = new Map(prev);
      next.delete(appId);
      return next;
    });
    set(previewErrorByAppIdAtom, (prev) => {
      const next = new Map(prev);
      next.delete(appId);
      return next;
    });
    set(previewAppExitByAppIdAtom, (prev) => {
      const next = new Map(prev);
      next.delete(appId);
      return next;
    });
    set(appUrlByAppIdAtom, (prev) => {
      const next = new Map(prev);
      next.delete(appId);
      return next;
    });
    set(previewReloadTokenByAppIdAtom, (prev) => {
      const next = new Map(prev);
      next.delete(appId);
      return next;
    });
    set(consoleEntriesByAppIdAtom, (prev) => {
      const next = new Map(prev);
      next.delete(appId);
      return next;
    });
    set(previewCurrentUrlAtom, (prev) => {
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
