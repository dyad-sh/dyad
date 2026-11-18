import { atom } from "jotai";

// Dismissal is per app and lasts for this renderer session. Reconnection remains
// available outside chat, and restarting Dyad shows the reminder again.
export const dismissedNeonReconnectionAppIdsAtom = atom<ReadonlySet<number>>(
  new Set<number>(),
);

export const removeNeonReconnectionDismissalsAtom = atom(
  null,
  (get, set, appIds: readonly number[]) => {
    const current = get(dismissedNeonReconnectionAppIdsAtom);
    const remaining = new Set(current);
    for (const appId of appIds) remaining.delete(appId);
    if (remaining.size !== current.size) {
      set(dismissedNeonReconnectionAppIdsAtom, remaining);
    }
  },
);
