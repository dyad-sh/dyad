import type { createStore } from "jotai";
import { selectedComponentsPreviewAtom } from "@/atoms/previewAtoms";
import { setPreviewErrorForAppAtom } from "@/atoms/previewRuntimeAtoms";
import type { PreviewIframeCommandRunner } from "./controller";
import type { PreviewIframeEvent, PreviewIframePostMessage } from "./state";

type JotaiStore = ReturnType<typeof createStore>;

export interface PreviewIframeTarget {
  postMessage(message: unknown, targetOrigin: string): void;
}

export interface PreviewIframeCommandAdapter extends PreviewIframeCommandRunner {
  attach(appId: number, target: () => PreviewIframeTarget | null): () => void;
  post(
    appId: number,
    message:
      | Exclude<PreviewIframePostMessage, { type: "restore-overlays" }>
      | { type: "dyad-take-screenshot"; requestId: string },
  ): void;
}

export function createPreviewIframeCommandAdapter(
  store: JotaiStore,
): PreviewIframeCommandAdapter {
  const targets = new Map<number, () => PreviewIframeTarget | null>();

  const post = (
    appId: number,
    message:
      | Exclude<PreviewIframePostMessage, { type: "restore-overlays" }>
      | { type: "dyad-take-screenshot"; requestId: string },
  ) => targets.get(appId)?.()?.postMessage(message, "*");

  return {
    attach(appId, target) {
      targets.set(appId, target);
      return () => {
        if (targets.get(appId) === target) targets.delete(appId);
      };
    },
    execute(appId, command, emit) {
      switch (command.type) {
        case "clear-preview-error":
          store.set(setPreviewErrorForAppAtom, { appId, error: undefined });
          return;
        case "post-to-iframe":
          if (command.message.type !== "restore-overlays") {
            post(appId, command.message);
            return;
          }
          {
            const target = targets.get(appId)?.();
            if (!target) return;
            const componentIds = store
              .get(selectedComponentsPreviewAtom)
              .map((component) => component.id);
            target.postMessage(
              componentIds.length === 0
                ? { type: "clear-dyad-component-overlays" }
                : {
                    type: "restore-dyad-component-overlays",
                    componentIds,
                  },
              "*",
            );
            emit({ type: "SELECTION_RESTORED" });
          }
          return;
        default:
          return assertNever(command);
      }
    },
    post,
  };
}

function assertNever(value: never): never {
  throw new Error(
    `Unexpected preview iframe command: ${JSON.stringify(value)}`,
  );
}

export type PreviewIframeMachineMessageType =
  | "dyad-component-selector-initialized"
  | "dyad-screenshot-response"
  | "pushState"
  | "replaceState";

export const PREVIEW_IFRAME_MESSAGE_ROUTES: Readonly<
  Record<
    PreviewIframeMachineMessageType,
    "machine" | "shared-and-component" | "component"
  >
> = {
  "dyad-component-selector-initialized": "shared-and-component",
  // The screenshot machine and annotator share this response. Correlation by
  // requestId lets each owner ignore messages belonging to the other.
  "dyad-screenshot-response": "shared-and-component",
  pushState: "machine",
  replaceState: "machine",
};

export type PreviewSharedMachineEvent =
  | { type: "SELECTOR_READY" }
  | {
      type: "RESPONSE";
      requestId: string;
      ok: boolean;
      dataUrl?: string;
    };

export function routePreviewIframeMessage(input: {
  event: MessageEvent;
  contentWindow: PreviewIframeTarget | null;
  appUrl: string | null;
  send: (event: PreviewIframeEvent) => void;
  onSharedMachineEvent: (event: PreviewSharedMachineEvent) => void;
  onComponentMessage: (event: MessageEvent) => void;
}): void {
  const {
    event,
    contentWindow,
    appUrl,
    send,
    onSharedMachineEvent,
    onComponentMessage,
  } = input;
  if (event.source !== contentWindow) return;
  const type = event.data?.type as string | undefined;
  const route =
    type && type in PREVIEW_IFRAME_MESSAGE_ROUTES
      ? PREVIEW_IFRAME_MESSAGE_ROUTES[type as PreviewIframeMachineMessageType]
      : undefined;

  if (type === "dyad-component-selector-initialized") {
    send({ type: "SELECTOR_READY" });
    onSharedMachineEvent({ type: "SELECTOR_READY" });
  } else if (type === "dyad-screenshot-response") {
    const requestId = event.data?.requestId;
    if (typeof requestId === "string") {
      onSharedMachineEvent({
        type: "RESPONSE",
        requestId,
        ok: event.data?.success === true,
        ...(typeof event.data?.dataUrl === "string"
          ? { dataUrl: event.data.dataUrl }
          : {}),
      });
    }
  } else if (type === "pushState" || type === "replaceState") {
    const rawUrl = event.data?.payload?.newUrl;
    if (typeof rawUrl === "string" && rawUrl && appUrl) {
      try {
        const trustedAppUrl = new URL(appUrl);
        const url = new URL(rawUrl, trustedAppUrl);
        if (url.origin !== trustedAppUrl.origin) return;
        send({ type: "NAVIGATED_IN_APP", kind: type, url: url.href });
      } catch {
        return;
      }
    }
  }

  if (route !== "machine") onComponentMessage(event);
}
