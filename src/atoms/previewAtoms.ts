import type {
  ComponentSelection,
  VisualEditingChange,
} from "@/ipc/types/visual-editing";
import { selectedAppIdAtom } from "@/atoms/appAtoms";
import { atom } from "jotai";

export const selectedComponentsPreviewAtom = atom<ComponentSelection[]>([]);

export const visualEditingSelectedComponentAtom =
  atom<ComponentSelection | null>(null);

export const currentComponentCoordinatesAtom = atom<{
  top: number;
  left: number;
  width: number;
  height: number;
} | null>(null);

export const previewIframeRefAtom = atom<HTMLIFrameElement | null>(null);

export const annotatorModeAtom = atom(false);
export const screenshotDataUrlAtom = atom<string | null>(null);
const pendingVisualChangesByAppAtom = atom<
  Map<number, Map<string, VisualEditingChange>>
>(new Map());

export const clearPendingVisualChangesForAppAtom = atom(
  null,
  (get, set, appId: number) => {
    const byApp = new Map(get(pendingVisualChangesByAppAtom));
    byApp.delete(appId);
    set(pendingVisualChangesByAppAtom, byApp);
  },
);

export const pendingVisualChangesAtom = atom(
  (get) => {
    const appId = get(selectedAppIdAtom);
    return appId === null
      ? new Map<string, VisualEditingChange>()
      : (get(pendingVisualChangesByAppAtom).get(appId) ??
          new Map<string, VisualEditingChange>());
  },
  (
    get,
    set,
    update:
      | Map<string, VisualEditingChange>
      | ((
          current: Map<string, VisualEditingChange>,
        ) => Map<string, VisualEditingChange>),
  ) => {
    const appId = get(selectedAppIdAtom);
    if (appId === null) return;
    const byApp = new Map(get(pendingVisualChangesByAppAtom));
    const current = byApp.get(appId) ?? new Map<string, VisualEditingChange>();
    const next = typeof update === "function" ? update(current) : update;
    if (next.size === 0) {
      byApp.delete(appId);
    } else {
      byApp.set(appId, next);
    }
    set(pendingVisualChangesByAppAtom, byApp);
  },
);
