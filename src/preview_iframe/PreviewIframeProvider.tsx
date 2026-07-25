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
import type {
  AppRunStateSnapshot,
  AppRunStateSubscriptionFacade,
} from "@/app_wiring/cross_machine_facades";
import { usePreviewErrorFacade } from "@/app_wiring/preview_error_facade";
import {
  useManagerLifecycle,
  useRegisterEntityDisposer,
} from "@/state_machines/react";
import { createPreviewIframeCommandAdapter } from "./commands";
import { PreviewIframeManager } from "./manager";

const PreviewIframeContext = createContext<PreviewIframeManager | null>(null);

type LegacyRunStateForPreview =
  | { readonly type: "idle" }
  | {
      readonly type: "starting";
      readonly operation: string;
      readonly invocationRef: { readonly operationId: string };
    }
  | {
      readonly type: "ready" | "reloading" | "stopping" | "stopped" | "errored";
      readonly invocationRef: { readonly operationId: string };
    };

export function PreviewIframeProvider({
  children,
  appRunState,
  manager: injectedManager,
}: {
  children: ReactNode;
  appRunState:
    | AppRunStateSubscriptionFacade
    | {
        subscribeRunStateChanged(
          listener: (appId: number, state: LegacyRunStateForPreview) => void,
        ): () => void;
      };
  manager?: PreviewIframeManager;
}) {
  const store = useStore();
  const previewErrors = usePreviewErrorFacade();
  const [manager] = useState(
    () =>
      injectedManager ??
      new PreviewIframeManager(createPreviewIframeCommandAdapter(store)),
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
    const subscribe = appRunState.subscribeRunStateChanged as (
      listener: (
        appId: number,
        state: LegacyRunStateForPreview | AppRunStateSnapshot,
      ) => void,
    ) => () => void;
    return subscribe((appId, runState) => {
      const isRestart =
        "phase" in runState
          ? runState.phase === "starting" &&
            runState.operation !== "run" &&
            runState.invocationRef !== null
          : runState.type === "starting" && runState.operation !== "run";
      const invocationRef =
        "phase" in runState
          ? runState.invocationRef
          : runState.type === "idle"
            ? null
            : runState.invocationRef;
      if (!isRestart || !invocationRef) {
        handledRestartInvocationIds.current.delete(appId);
        return;
      }
      if (
        handledRestartInvocationIds.current.get(appId) ===
        invocationRef.operationId
      ) {
        return;
      }
      handledRestartInvocationIds.current.set(appId, invocationRef.operationId);
      manager.send(appId, { type: "RUNTIME_RESTARTED" });
    });
  }, [appRunState, manager]);

  useEffect(
    () =>
      previewErrors.registerSource({
        setAppError: (appId, message) =>
          manager.send(appId, { type: "APP_ERROR", message }),
        clearAppError: (appId) =>
          manager.send(appId, { type: "APP_ERROR_CLEARED" }),
        setSyncError: (appId, message) =>
          manager.send(appId, { type: "SYNC_ERROR", message }),
        clearSyncError: (appId) =>
          manager.send(appId, { type: "SYNC_RECOVERED" }),
      }),
    [manager, previewErrors],
  );

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
