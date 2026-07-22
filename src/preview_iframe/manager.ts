import { KeyedControllerHost } from "@/state_machines/keyed_host";
import { createTraceObserver } from "@/state_machines/trace";
import type { PreviewIframeCommandAdapter } from "./commands";
import { PreviewIframeController } from "./controller";
import {
  INITIAL_PREVIEW_IFRAME_STATE,
  type PreviewIframeEvent,
  type PreviewIframeState,
} from "./state";

export class PreviewIframeManager {
  private readonly host: KeyedControllerHost<number, PreviewIframeController>;

  constructor(readonly commands: PreviewIframeCommandAdapter) {
    this.host = new KeyedControllerHost(
      (appId) =>
        new PreviewIframeController(
          appId,
          commands,
          createTraceObserver("preview_iframe", appId),
        ),
    );
  }

  getSnapshot = (appId: number): PreviewIframeState =>
    this.host.get(appId)?.getSnapshot() ?? INITIAL_PREVIEW_IFRAME_STATE;

  subscribeKey = (appId: number, listener: () => void): (() => void) =>
    this.host.subscribeKey(appId, listener);

  send(appId: number, event: PreviewIframeEvent): void {
    this.host.ensure(appId).send(event);
  }

  disposeKey(appId: number): void {
    this.host.disposeKey(appId);
  }

  dispose(): void {
    this.host.dispose();
  }
}
