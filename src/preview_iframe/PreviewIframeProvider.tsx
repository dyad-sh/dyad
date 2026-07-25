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
import { useAppRunManager } from "@/app_run/AppRunProvider";
import {
  useManagerLifecycle,
  useRegisterEntityDisposer,
} from "@/state_machines/react";
import { createPreviewIframeCommandAdapter } from "./commands";
import { PreviewIframeManager } from "./manager";

const PreviewIframeContext = createContext<PreviewIframeManager | null>(null);

export function PreviewIframeProvider({ children }: { children: ReactNode }) {
  const store = useStore();
  const appRunManager = useAppRunManager();
  const [manager] = useState(
    () => new PreviewIframeManager(createPreviewIframeCommandAdapter(store)),
  );
  const disposeApp = useCallback(
    (appId: number) => manager.disposeKey(appId),
    [manager],
  );
  const handledRestartInvocationIds = useRef(new Map<number, string>());

  useEffect(() => {
    return appRunManager.subscribeRunStateChanged((appId, runState) => {
      if (runState.type !== "starting" || runState.operation !== "restart") {
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
  }, [appRunManager, manager]);

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
