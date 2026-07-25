import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useStore } from "jotai";
import type { AppRunStateSubscriptionFacade } from "@/app_wiring/cross_machine_facades";
import {
  useManagerLifecycle,
  useRegisterEntityDisposer,
} from "@/state_machines/react";
import { createPreviewIframeCommandAdapter } from "./commands";
import { PreviewIframeManager } from "./manager";

const PreviewIframeContext = createContext<PreviewIframeManager | null>(null);

export function PreviewIframeProvider({
  children,
  appRunState,
}: {
  children: ReactNode;
  appRunState: AppRunStateSubscriptionFacade;
}) {
  const store = useStore();
  const [manager] = useState(
    () => new PreviewIframeManager(createPreviewIframeCommandAdapter(store)),
  );
  const handledRestartInvocationIds = useRef(new Map<number, string>());
  const disposeApp = useCallback(
    (appId: number) => {
      handledRestartInvocationIds.current.delete(appId);
      manager.disposeKey(appId);
    },
    [manager],
  );

  useEffect(() => {
    return appRunState.subscribeRunStateChanged((appId, runState) => {
      if (runState.type !== "starting" || runState.operation === "run") {
        handledRestartInvocationIds.current.delete(appId);
        return;
      }
      if (
        handledRestartInvocationIds.current.get(appId) ===
        runState.invocationRef.operationId
      ) {
        return;
      }
      handledRestartInvocationIds.current.set(
        appId,
        runState.invocationRef.operationId,
      );
      manager.send(appId, { type: "RUNTIME_RESTARTED" });
    });
  }, [appRunState, manager]);

  useManagerLifecycle(manager);
  useRegisterEntityDisposer("app", disposeApp);
  return (
    <PreviewIframeContext.Provider value={manager}>
      {children}
    </PreviewIframeContext.Provider>
  );
}

export function usePreviewIframeManager(): PreviewIframeManager {
  const manager = useContext(PreviewIframeContext);
  if (!manager) {
    throw new Error("usePreviewIframeManager requires PreviewIframeProvider");
  }
  return manager;
}
