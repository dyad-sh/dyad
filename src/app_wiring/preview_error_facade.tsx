import {
  createContext,
  useContext,
  useState,
  type PropsWithChildren,
} from "react";
import { useManagerLifecycle } from "@/state_machines/react";

export interface PreviewAppErrorSource {
  setAppError(appId: number, message: string): void;
  clearAppError(appId: number): void;
  setSyncError(appId: number, message: string): void;
  clearSyncError(appId: number): void;
}

/**
 * Multi-consumer bridge from app_run producers to preview_iframe owners.
 * Delivery always crosses a microtask because app_run commands execute before
 * their controller finishes notifying the committed transition.
 */
export class DeferredPreviewErrorFacade {
  private readonly sources = new Set<PreviewAppErrorSource>();
  private disposed = false;

  registerSource(source: PreviewAppErrorSource): () => void {
    if (this.disposed) return () => undefined;
    this.sources.add(source);
    return () => this.sources.delete(source);
  }

  /** Remote intent: state-sensitive presentation update. */
  setAppError = (appId: number, message: string): void => {
    this.defer((source) => source.setAppError(appId, message));
  };

  /** Remote intent: idempotent presentation clear. */
  clearAppError = (appId: number): void => {
    this.defer((source) => source.clearAppError(appId));
  };

  /** Remote intent: state-sensitive presentation update. */
  setSyncError = (appId: number, message: string): void => {
    this.defer((source) => source.setSyncError(appId, message));
  };

  /** Remote intent: idempotent presentation recovery. */
  clearSyncError = (appId: number): void => {
    this.defer((source) => source.clearSyncError(appId));
  };

  dispose(): void {
    this.disposed = true;
    this.sources.clear();
  }

  private defer(deliver: (source: PreviewAppErrorSource) => void): void {
    queueMicrotask(() => {
      if (this.disposed) return;
      for (const source of this.sources) deliver(source);
    });
  }
}

const Context = createContext<DeferredPreviewErrorFacade | null>(null);

export function PreviewErrorFacadeProvider({
  children,
  facade: injectedFacade,
}: PropsWithChildren<{ facade?: DeferredPreviewErrorFacade }>) {
  const [ownedFacade] = useState(() => new DeferredPreviewErrorFacade());
  const facade = injectedFacade ?? ownedFacade;
  useManagerLifecycle(facade);
  return <Context.Provider value={facade}>{children}</Context.Provider>;
}

export function usePreviewErrorFacade(): DeferredPreviewErrorFacade {
  const facade = useContext(Context);
  if (!facade) {
    throw new Error(
      "usePreviewErrorFacade requires PreviewErrorFacadeProvider",
    );
  }
  return facade;
}
