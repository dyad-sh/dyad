import { setPreviewRunStateForAppAtom } from "@/atoms/previewRuntimeAtoms";
import { KeyedControllerHost } from "@/state_machines/keyed_host";
import { createIpcRunCommandExecutor, type JotaiStore } from "./commands";
import {
  AppRunController,
  type RunOperationInput,
  type RunProducerInput,
} from "./controller";
import type { RunState } from "./state";
import type { RunCommand, RunEvent } from "./state";
import type { TransitionObserver } from "@/state_machines/types";
import { projectRunState } from "./transition";

const IDLE_STATE: RunState = { type: "idle" };

/** Provider-owned facade for the app-keyed run-state controllers. */
export class AppRunManager {
  private readonly host: KeyedControllerHost<number, AppRunController>;

  constructor(
    store: JotaiStore,
    observer?: TransitionObserver<RunState, RunEvent, RunCommand>,
  ) {
    this.host = new KeyedControllerHost(
      (appId) =>
        new AppRunController({
          appId,
          executor: createIpcRunCommandExecutor(store),
          onStateChange: (state) => {
            // The machine is the sole writer of the legacy run-state
            // projection consumed by preview runtime atoms.
            store.set(setPreviewRunStateForAppAtom, {
              appId,
              state: projectRunState(state),
            });
          },
          observer,
        }),
    );
  }

  getSnapshot = (appId: number): RunState =>
    this.host.get(appId)?.getSnapshot() ?? IDLE_STATE;

  subscribeKey = (appId: number, listener: () => void): (() => void) =>
    this.host.subscribeKey(appId, listener);

  dispatch(appId: number, input: RunOperationInput): Promise<void> {
    return this.host.ensure(appId).dispatch(input);
  }

  send(appId: number, input: RunProducerInput): void {
    this.host.ensure(appId).send(input);
  }

  disposeKey(appId: number): void {
    this.host.disposeKey(appId);
  }

  dispose(): void {
    this.host.dispose();
  }
}
