import { SnapshotStore } from "@/state_machines/snapshot_store";
import {
  CLOSED_STATE,
  type PreviewEvent,
  type PreviewSession,
  type PreviewState,
} from "./state";

type PresentationState =
  | { readonly type: "closed" }
  | { readonly type: "browsing" }
  | {
      readonly type: "viewing-diff";
      readonly versionId: string;
      readonly file: PreviewSession["selectedDiffFile"];
      readonly paneVisible: boolean;
    };

const CLOSED_PRESENTATION: PresentationState = { type: "closed" };

/**
 * Window-local state for pane visibility and diff selection. Repository
 * lifecycle facts never enter this store; they are projected by the main actor.
 */
export class VersionPreviewPresentationStore {
  private readonly stores = new Map<number, SnapshotStore<PresentationState>>();

  getSnapshot = (appId: number): PresentationState =>
    this.stores.get(appId)?.getSnapshot() ?? CLOSED_PRESENTATION;

  subscribe = (appId: number, listener: () => void): (() => void) => {
    const store = this.ensure(appId);
    return store.subscribe(listener);
  };

  isPaneVisible(appId: number): boolean {
    const state = this.getSnapshot(appId);
    if (state.type === "browsing") return true;
    return state.type === "viewing-diff" && state.paneVisible;
  }

  send(appId: number, event: PreviewEvent): void {
    const store = this.ensure(appId);
    const current = store.getSnapshot();
    switch (event.type) {
      case "OPEN":
        store.setState({ type: "browsing" });
        return;
      case "SELECT_VERSION":
        store.setState({
          type: "viewing-diff",
          versionId: event.versionId,
          file: null,
          paneVisible: true,
        });
        return;
      case "VIEW_VERSION_DIFF":
        store.setState({
          type: "viewing-diff",
          versionId: event.versionId,
          file: event.file,
          paneVisible: false,
        });
        return;
      case "SELECT_DIFF_FILE":
        if (current.type === "viewing-diff") {
          store.setState({ ...current, file: event.file });
        }
        return;
      case "CLOSE_VERSION_DIFF":
        store.setState(
          current.type === "viewing-diff" ? CLOSED_PRESENTATION : current,
        );
        return;
      case "CLOSE":
      case "APP_CHANGED":
        store.setState(CLOSED_PRESENTATION);
        return;
      default:
        return;
    }
  }

  disposeKey = (appId: number): void => {
    this.stores.get(appId)?.dispose();
    this.stores.delete(appId);
  };

  dispose(): void {
    for (const store of this.stores.values()) store.dispose();
    this.stores.clear();
  }

  private ensure(appId: number): SnapshotStore<PresentationState> {
    let store = this.stores.get(appId);
    if (!store) {
      store = new SnapshotStore<PresentationState>(CLOSED_PRESENTATION);
      this.stores.set(appId, store);
    }
    return store;
  }
}

function presentationSession(
  appId: number,
  presentation: Exclude<PresentationState, { type: "closed" }>,
): PreviewSession {
  return {
    appId,
    originBranch: null,
    targetVersionId:
      presentation.type === "viewing-diff" ? presentation.versionId : null,
    checkedOutVersionId: null,
    exitIntent: { type: "none" },
    selectedDiffFile:
      presentation.type === "viewing-diff" ? presentation.file : null,
    isDiffVisible: presentation.type === "viewing-diff",
  };
}

export function combineVersionPreviewState(
  appId: number,
  remote: PreviewState,
  presentation: PresentationState,
): PreviewState {
  if (
    remote.type === "returning" ||
    remote.type === "switching-branch" ||
    remote.type === "recovery-required"
  ) {
    return remote;
  }
  if (
    remote.type !== "closed" &&
    remote.type !== "browsing" &&
    remote.type !== "viewing-diff"
  ) {
    const isDiffVisible =
      presentation.type === "viewing-diff" &&
      presentation.versionId === remote.session.targetVersionId;
    return {
      ...remote,
      session: {
        ...remote.session,
        selectedDiffFile: isDiffVisible ? presentation.file : null,
        isDiffVisible,
      },
    };
  }
  if (presentation.type === "closed") return CLOSED_STATE;
  const session = presentationSession(appId, presentation);
  return presentation.type === "browsing"
    ? { type: "browsing", session }
    : { type: "viewing-diff", session };
}
