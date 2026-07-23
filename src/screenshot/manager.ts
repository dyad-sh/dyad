import { KeyedControllerHost } from "@/state_machines/keyed_host";
import { createTraceObserver } from "@/state_machines/trace";
import type { ScreenshotCommandAdapter } from "./commands";
import { ScreenshotController } from "./controller";
import {
  INITIAL_SCREENSHOT_STATE,
  type ScreenshotEvent,
  type ScreenshotState,
} from "./state";

export class ScreenshotManager {
  private readonly host: KeyedControllerHost<number, ScreenshotController>;

  constructor(readonly commands: ScreenshotCommandAdapter) {
    this.host = new KeyedControllerHost(
      (appId) =>
        new ScreenshotController(
          appId,
          commands,
          createTraceObserver("screenshot", appId),
        ),
    );
  }

  getSnapshot = (appId: number): ScreenshotState =>
    this.host.get(appId)?.getSnapshot() ?? INITIAL_SCREENSHOT_STATE;

  subscribeKey = (appId: number, listener: () => void): (() => void) =>
    this.host.subscribeKey(appId, listener);

  send(appId: number, event: ScreenshotEvent): void {
    this.host.ensure(appId).send(event);
  }

  disposeKey = (appId: number): void => {
    this.host.disposeKey(appId);
  };

  dispose(): void {
    this.host.dispose();
  }
}
