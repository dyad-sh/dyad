import { setPreviewRunStateForAppAtom } from "@/atoms/previewRuntimeAtoms";
import { createIpcRunCommandExecutor, type JotaiStore } from "./commands";
import { AppRunController } from "./controller";
import { projectRunState } from "./transition";

/**
 * Per-store, per-app controller registry. Controllers persist across app
 * switches (run state has always been keyed per app); keying by Jotai store
 * keeps test stores isolated from each other and from the default store.
 */
const controllersByStore = new WeakMap<
  JotaiStore,
  Map<number, AppRunController>
>();

export function getAppRunController(
  store: JotaiStore,
  appId: number,
): AppRunController {
  let byApp = controllersByStore.get(store);
  if (!byApp) {
    byApp = new Map();
    controllersByStore.set(store, byApp);
  }
  let controller = byApp.get(appId);
  if (!controller) {
    controller = new AppRunController({
      appId,
      executor: createIpcRunCommandExecutor(store),
      onStateChange: (state) => {
        // The machine is the sole writer of the legacy run-state projection;
        // `currentPreviewLoadingAtom` and friends keep deriving from it.
        store.set(setPreviewRunStateForAppAtom, {
          appId,
          state: projectRunState(state),
        });
      },
    });
    byApp.set(appId, controller);
  }
  return controller;
}

/**
 * Drop the controller for a deleted app so the registry doesn't accumulate
 * controllers forever. A stray late event for the app would lazily create a
 * fresh idle controller, which is harmless.
 */
export function disposeAppRunController(
  store: JotaiStore,
  appId: number,
): void {
  controllersByStore.get(store)?.delete(appId);
}
