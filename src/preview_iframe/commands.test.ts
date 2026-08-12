import { createStore } from "jotai";
import { describe, expect, it, vi } from "vitest";
import { selectedComponentsPreviewAtom } from "@/atoms/previewAtoms";
import {
  PREVIEW_IFRAME_MESSAGE_ROUTES,
  createPreviewIframeCommandAdapter,
  routePreviewIframeMessage,
} from "./commands";
import type { PreviewIframeEvent } from "./state";

describe("preview iframe command adapter", () => {
  it("routes machine messages and leaves component routes claimable", () => {
    const contentWindow = { postMessage: vi.fn() };
    const send = vi.fn<(event: PreviewIframeEvent) => void>();
    const onSharedMachineEvent = vi.fn();
    const onComponentMessage = vi.fn();

    routePreviewIframeMessage({
      event: {
        source: contentWindow,
        data: { type: "pushState", payload: { newUrl: "/settings" } },
      } as unknown as MessageEvent,
      contentWindow,
      appUrl: "http://localhost:3000",
      send,
      onSharedMachineEvent,
      onComponentMessage,
    });
    expect(send).toHaveBeenCalledWith({
      type: "NAVIGATED_IN_APP",
      kind: "pushState",
      url: "http://localhost:3000/settings",
    });
    expect(onComponentMessage).not.toHaveBeenCalled();

    const selectorMessage = {
      source: contentWindow,
      data: { type: "dyad-component-selector-initialized" },
    } as unknown as MessageEvent;
    routePreviewIframeMessage({
      event: selectorMessage,
      contentWindow,
      appUrl: "http://localhost:3000",
      send,
      onSharedMachineEvent,
      onComponentMessage,
    });
    expect(send).toHaveBeenCalledWith({ type: "SELECTOR_READY" });
    expect(onSharedMachineEvent).toHaveBeenCalledWith({
      type: "SELECTOR_READY",
    });
    expect(onComponentMessage).toHaveBeenCalledWith(selectorMessage);
    expect(PREVIEW_IFRAME_MESSAGE_ROUTES).toEqual({
      "dyad-component-selector-initialized": "shared-and-component",
      "dyad-screenshot-response": "shared-and-component",
      pushState: "machine",
      replaceState: "machine",
      "dyad-document-loaded": "machine",
    });

    const responseMessage = {
      source: contentWindow,
      data: {
        type: "dyad-screenshot-response",
        requestId: "capture:1",
        success: true,
        dataUrl: "data:image/png;base64,abc",
      },
    } as unknown as MessageEvent;
    routePreviewIframeMessage({
      event: responseMessage,
      contentWindow,
      appUrl: "http://localhost:3000",
      send,
      onSharedMachineEvent,
      onComponentMessage,
    });
    expect(onSharedMachineEvent).toHaveBeenLastCalledWith({
      type: "RESPONSE",
      requestId: "capture:1",
      ok: true,
      dataUrl: "data:image/png;base64,abc",
    });
    expect(onComponentMessage).toHaveBeenLastCalledWith(responseMessage);
  });

  // A link or a server redirect replaces the whole document without touching
  // history.pushState/replaceState, so the shim announces each load instead.
  // Without it the preview keeps reporting the last route Dyad selected, and a
  // recording started afterwards opens there rather than where the flow began.
  it("routes a document load as an app-driven navigation", () => {
    const contentWindow = { postMessage: vi.fn() };
    const send = vi.fn<(event: PreviewIframeEvent) => void>();
    const onSharedMachineEvent = vi.fn();
    const onComponentMessage = vi.fn();

    routePreviewIframeMessage({
      event: {
        source: contentWindow,
        data: {
          type: "dyad-document-loaded",
          payload: { newUrl: "http://localhost:3000/dashboard" },
        },
      } as unknown as MessageEvent,
      contentWindow,
      appUrl: "http://localhost:3000",
      send,
      onSharedMachineEvent,
      onComponentMessage,
    });

    expect(send).toHaveBeenCalledWith({
      type: "NAVIGATED_IN_APP",
      kind: "documentLoad",
      url: "http://localhost:3000/dashboard",
      // No signal from the shim reads as "reused the slot" — the conservative
      // side, since it never invents a history entry the browser lacks.
      replacesEntry: true,
    });
    // Machine-only: the component layer has no use for it.
    expect(onComponentMessage).not.toHaveBeenCalled();
  });

  // A plain link grows the browser's history, and the preview's has to grow
  // with it or Back skips the page the user came from.
  it("carries the shim's history-entry signal for a link navigation", () => {
    const contentWindow = { postMessage: vi.fn() };
    const send = vi.fn<(event: PreviewIframeEvent) => void>();

    routePreviewIframeMessage({
      event: {
        source: contentWindow,
        data: {
          type: "dyad-document-loaded",
          payload: {
            newUrl: "http://localhost:3000/dashboard",
            replacesEntry: false,
          },
        },
      } as unknown as MessageEvent,
      contentWindow,
      appUrl: "http://localhost:3000",
      send,
      onSharedMachineEvent: vi.fn(),
      onComponentMessage: vi.fn(),
    });

    expect(send).toHaveBeenCalledWith({
      type: "NAVIGATED_IN_APP",
      kind: "documentLoad",
      url: "http://localhost:3000/dashboard",
      replacesEntry: false,
    });
  });

  // `blob:` inherits the app's origin, so the origin check alone lets it
  // through — but it is not a route the preview can load or a recording replay.
  it("rejects a same-origin blob URL", () => {
    const contentWindow = { postMessage: vi.fn() };
    const send = vi.fn<(event: PreviewIframeEvent) => void>();

    routePreviewIframeMessage({
      event: {
        source: contentWindow,
        data: {
          type: "dyad-document-loaded",
          payload: {
            newUrl: "blob:http://localhost:3000/8f1c4a2e-0000-4000-8000-abc",
          },
        },
      } as unknown as MessageEvent,
      contentWindow,
      appUrl: "http://localhost:3000",
      send,
      onSharedMachineEvent: vi.fn(),
      onComponentMessage: vi.fn(),
    });

    expect(send).not.toHaveBeenCalled();
  });

  it("rejects iframe navigation outside the trusted app origin", () => {
    const contentWindow = { postMessage: vi.fn() };
    const send = vi.fn<(event: PreviewIframeEvent) => void>();
    const onSharedMachineEvent = vi.fn();
    const onComponentMessage = vi.fn();

    for (const type of [
      "replaceState",
      "pushState",
      "dyad-document-loaded",
    ] as const) {
      for (const newUrl of ["https://untrusted.example/path", "http://["]) {
        routePreviewIframeMessage({
          event: {
            source: contentWindow,
            data: { type, payload: { newUrl } },
          } as unknown as MessageEvent,
          contentWindow,
          appUrl: "http://localhost:3000",
          send,
          onSharedMachineEvent,
          onComponentMessage,
        });
      }
    }

    expect(send).not.toHaveBeenCalled();
    expect(onComponentMessage).not.toHaveBeenCalled();
  });

  it("posts navigation and restores the current selection exactly once", () => {
    const store = createStore();
    store.set(selectedComponentsPreviewAtom, [
      {
        id: "component-1",
        name: "Card",
        relativePath: "src/Card.tsx",
        lineNumber: 1,
        columnNumber: 1,
      },
    ]);
    const adapter = createPreviewIframeCommandAdapter(store);
    const target = { postMessage: vi.fn() };
    adapter.attach(7, () => target);
    const emit = vi.fn<(event: PreviewIframeEvent) => void>();

    adapter.execute(
      7,
      {
        type: "post-to-iframe",
        message: {
          type: "navigate",
          payload: { url: "http://localhost:3000/settings" },
        },
      },
      emit,
    );
    adapter.execute(
      7,
      { type: "post-to-iframe", message: { type: "restore-overlays" } },
      emit,
    );

    expect(target.postMessage).toHaveBeenNthCalledWith(
      1,
      {
        type: "navigate",
        payload: { url: "http://localhost:3000/settings" },
      },
      "*",
    );
    expect(target.postMessage).toHaveBeenNthCalledWith(
      2,
      {
        type: "restore-dyad-component-overlays",
        componentIds: ["component-1"],
      },
      "*",
    );
    expect(emit).toHaveBeenCalledOnce();
    expect(emit).toHaveBeenCalledWith({ type: "SELECTION_RESTORED" });
  });
});
