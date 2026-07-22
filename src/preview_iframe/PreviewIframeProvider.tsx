import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useAtomValue, useStore } from "jotai";
import { previewRunStateByAppIdAtom } from "@/atoms/previewRuntimeAtoms";
import {
  useManagerLifecycle,
  useRegisterEntityDisposer,
} from "@/state_machines/react";
import { createPreviewIframeCommandAdapter } from "./commands";
import { PreviewIframeManager } from "./manager";

const PreviewIframeContext = createContext<PreviewIframeManager | null>(null);

export function PreviewIframeProvider({ children }: { children: ReactNode }) {
  const store = useStore();
  const runStates = useAtomValue(previewRunStateByAppIdAtom);
  const [manager] = useState(
    () => new PreviewIframeManager(createPreviewIframeCommandAdapter(store)),
  );
  const handledRestartStartedAt = useRef(new Map<number, number>());

  useEffect(() => {
    for (const [appId, runState] of runStates) {
      if (runState.operation !== "restart") {
        handledRestartStartedAt.current.delete(appId);
        continue;
      }
      if (handledRestartStartedAt.current.get(appId) === runState.startedAt) {
        continue;
      }
      handledRestartStartedAt.current.set(appId, runState.startedAt);
      manager.send(appId, { type: "RUNTIME_RESTARTED" });
    }
    for (const appId of handledRestartStartedAt.current.keys()) {
      if (!runStates.has(appId)) {
        handledRestartStartedAt.current.delete(appId);
      }
    }
  }, [manager, runStates]);

  useManagerLifecycle(manager);
  useRegisterEntityDisposer("app", manager.disposeKey);
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
