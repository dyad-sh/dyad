import { createStore } from "jotai";
import { describe, expect, it, vi } from "vitest";
import { selectedComponentsPreviewAtom } from "@/atoms/previewAtoms";
import { previewErrorByAppIdAtom } from "@/atoms/previewRuntimeAtoms";
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
    const onComponentMessage = vi.fn();

    routePreviewIframeMessage({
      event: {
        source: contentWindow,
        data: { type: "pushState", payload: { newUrl: "/settings" } },
      } as unknown as MessageEvent,
      contentWindow,
      appUrl: "http://localhost:3000",
      send,
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
      onComponentMessage,
    });
    expect(send).toHaveBeenCalledWith({ type: "SELECTOR_READY" });
    expect(onComponentMessage).toHaveBeenCalledWith(selectorMessage);
    expect(PREVIEW_IFRAME_MESSAGE_ROUTES).toEqual({
      "dyad-component-selector-initialized": "machine-and-component",
      "dyad-screenshot-response": "component",
      pushState: "machine",
      replaceState: "machine",
    });
  });

  it("rejects iframe navigation outside the trusted app origin", () => {
    const contentWindow = { postMessage: vi.fn() };
    const send = vi.fn<(event: PreviewIframeEvent) => void>();
    const onComponentMessage = vi.fn();

    for (const newUrl of ["https://untrusted.example/path", "http://["]) {
      routePreviewIframeMessage({
        event: {
          source: contentWindow,
          data: { type: "replaceState", payload: { newUrl } },
        } as unknown as MessageEvent,
        contentWindow,
        appUrl: "http://localhost:3000",
        send,
        onComponentMessage,
      });
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

  it("clears only the addressed app's preview error", () => {
    const store = createStore();
    store.set(
      previewErrorByAppIdAtom,
      new Map([
        [7, { message: "old", source: "preview-app" as const }],
        [8, { message: "keep", source: "preview-app" as const }],
      ]),
    );
    const adapter = createPreviewIframeCommandAdapter(store);
    adapter.execute(7, { type: "clear-preview-error" }, vi.fn());
    expect(store.get(previewErrorByAppIdAtom).has(7)).toBe(false);
    expect(store.get(previewErrorByAppIdAtom).has(8)).toBe(true);
  });
});
