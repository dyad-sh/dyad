import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { createStore, Provider } from "jotai";
import type { PropsWithChildren, RefObject } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { selectedAppIdAtom } from "@/atoms/appAtoms";
import { pendingVisualChangesAtom } from "@/atoms/previewAtoms";
import type { VisualEditingChange } from "@/ipc/types";
import {
  MAX_VISUAL_TEXT_CACHE_ENTRIES,
  MAX_VISUAL_TEXT_ENTRY_BYTES,
  MAX_VISUAL_TEXT_TOTAL_BYTES,
  VISUAL_TEXT_RESPONSE_TIMEOUT_MS,
  VisualEditingChangesDialog,
} from "./VisualEditingChangesDialog";

const { applyChangesMock, showErrorMock, showSuccessMock } = vi.hoisted(() => ({
  applyChangesMock: vi.fn(),
  showErrorMock: vi.fn(),
  showSuccessMock: vi.fn(),
}));

vi.mock("@/ipc/types", () => ({
  ipc: {
    visualEditing: {
      applyChanges: applyChangesMock,
    },
  },
}));

vi.mock("@/lib/toast", () => ({
  showError: showErrorMock,
  showSuccess: showSuccessMock,
}));

function makeChange(componentId: string): VisualEditingChange {
  return {
    componentId,
    componentName: `Component ${componentId}`,
    relativePath: "src/App.tsx",
    lineNumber: 1,
    styles: {},
  };
}

function createIframe() {
  const iframe = document.createElement("iframe");
  document.body.appendChild(iframe);
  if (!iframe.contentWindow) {
    throw new Error("Expected test iframe to have a contentWindow");
  }
  const postMessageMock = vi
    .spyOn(iframe.contentWindow, "postMessage")
    .mockImplementation(() => undefined);
  return { iframe, iframeWindow: iframe.contentWindow, postMessageMock };
}

function sendTextResponse(
  source: MessageEventSource,
  componentId: unknown,
  text: unknown,
) {
  act(() => {
    window.dispatchEvent(
      new MessageEvent("message", {
        source,
        data: {
          type: "dyad-text-content-response",
          componentId,
          text,
        },
      }),
    );
  });
}

function renderDialog({
  changes = [makeChange("component-a")],
  appId = 1,
  iframe = createIframe().iframe,
  onReset = vi.fn(),
}: {
  changes?: VisualEditingChange[];
  appId?: number;
  iframe?: HTMLIFrameElement | null;
  onReset?: () => void;
} = {}) {
  const store = createStore();
  store.set(selectedAppIdAtom, appId);
  store.set(
    pendingVisualChangesAtom,
    new Map(changes.map((change) => [change.componentId, change])),
  );
  const iframeRef: RefObject<HTMLIFrameElement | null> = { current: iframe };
  const Wrapper = ({ children }: PropsWithChildren) => (
    <Provider store={store}>{children}</Provider>
  );
  const view = render(
    <VisualEditingChangesDialog iframeRef={iframeRef} onReset={onReset} />,
    { wrapper: Wrapper },
  );

  return { ...view, store, iframeRef, onReset };
}

describe("VisualEditingChangesDialog", () => {
  beforeEach(() => {
    applyChangesMock.mockReset();
    applyChangesMock.mockResolvedValue(undefined);
    showErrorMock.mockReset();
    showSuccessMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    document.querySelectorAll("iframe").forEach((iframe) => iframe.remove());
  });

  it("saves expected text returned by the current preview iframe", async () => {
    const { iframe, iframeWindow, postMessageMock } = createIframe();
    const { store, onReset } = renderDialog({ iframe });

    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

    expect(postMessageMock).toHaveBeenCalledWith(
      {
        type: "get-dyad-text-content",
        data: { componentId: "component-a" },
      },
      "*",
    );
    sendTextResponse(iframeWindow, "component-a", "Saved text");

    await waitFor(() => {
      expect(applyChangesMock).toHaveBeenCalledWith({
        appId: 1,
        changes: [
          expect.objectContaining({
            componentId: "component-a",
            textContent: "Saved text",
          }),
        ],
      });
    });
    expect(store.get(pendingVisualChangesAtom).size).toBe(0);
    expect(showSuccessMock).toHaveBeenCalledWith(
      "Visual changes saved to source files",
    );
    expect(onReset).toHaveBeenCalledTimes(1);
  });

  it("ignores responses from windows other than the current iframe", async () => {
    const { iframe, iframeWindow } = createIframe();
    renderDialog({ iframe });
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

    sendTextResponse(window, "component-a", "Untrusted text");
    expect(applyChangesMock).not.toHaveBeenCalled();

    sendTextResponse(iframeWindow, "component-a", "Trusted text");
    await waitFor(() => expect(applyChangesMock).toHaveBeenCalledTimes(1));
    expect(applyChangesMock.mock.calls[0][0].changes[0].textContent).toBe(
      "Trusted text",
    );
  });

  it("ignores unsolicited, malformed, and duplicate component responses", async () => {
    const { iframe, iframeWindow } = createIframe();
    renderDialog({
      iframe,
      changes: [makeChange("component-a"), makeChange("component-b")],
    });
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

    sendTextResponse(iframeWindow, "unexpected", "Unsolicited");
    sendTextResponse(iframeWindow, 123, "Malformed ID");
    sendTextResponse(iframeWindow, "component-a", { malformed: true });
    sendTextResponse(iframeWindow, "component-a", "First response");
    sendTextResponse(iframeWindow, "component-a", "Duplicate response");
    expect(applyChangesMock).not.toHaveBeenCalled();

    sendTextResponse(iframeWindow, "component-b", null);
    await waitFor(() => expect(applyChangesMock).toHaveBeenCalledTimes(1));
    expect(applyChangesMock.mock.calls[0][0].changes).toEqual([
      expect.objectContaining({
        componentId: "component-a",
        textContent: "First response",
      }),
      expect.objectContaining({ componentId: "component-b" }),
    ]);
    expect(
      applyChangesMock.mock.calls[0][0].changes[1].textContent,
    ).toBeUndefined();
  });

  it("rejects a text response over the per-entry byte limit", () => {
    const { iframe, iframeWindow } = createIframe();
    renderDialog({ iframe });
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

    sendTextResponse(
      iframeWindow,
      "component-a",
      "x".repeat(MAX_VISUAL_TEXT_ENTRY_BYTES + 1),
    );

    expect(applyChangesMock).not.toHaveBeenCalled();
    expect(showErrorMock).toHaveBeenCalledWith(
      expect.stringContaining("exceeds the 1 MiB limit"),
    );
    expect(
      screen.queryByRole("button", { name: "Save Changes" }),
    ).not.toBeNull();
    sendTextResponse(iframeWindow, "component-a", "Late response");
    expect(applyChangesMock).not.toHaveBeenCalled();
  });

  it("rejects responses that exceed the aggregate byte limit", () => {
    const { iframe, iframeWindow } = createIframe();
    const changes = Array.from({ length: 6 }, (_, index) =>
      makeChange(`component-${index}`),
    );
    renderDialog({ iframe, changes });
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

    const oneMiBText = "x".repeat(MAX_VISUAL_TEXT_ENTRY_BYTES);
    for (let index = 0; index < changes.length; index++) {
      sendTextResponse(iframeWindow, `component-${index}`, oneMiBText);
    }

    expect(applyChangesMock).not.toHaveBeenCalled();
    expect(showErrorMock).toHaveBeenCalledWith(
      expect.stringContaining("exceeds the 5 MiB limit"),
    );
  });

  it("rejects oversized pre-existing text before applying without an iframe", () => {
    renderDialog({
      iframe: null,
      changes: [
        {
          ...makeChange("component-a"),
          textContent: "x".repeat(MAX_VISUAL_TEXT_ENTRY_BYTES + 1),
        },
      ],
    });

    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

    expect(applyChangesMock).not.toHaveBeenCalled();
    expect(showErrorMock).toHaveBeenCalledWith(
      expect.stringContaining("exceeds the 1 MiB limit"),
    );
  });

  it("rejects aggregate pre-existing text before applying", () => {
    const textLength = MAX_VISUAL_TEXT_TOTAL_BYTES / 5;
    renderDialog({
      iframe: null,
      changes: Array.from({ length: 6 }, (_, index) => ({
        ...makeChange(`component-${index}`),
        textContent: "x".repeat(textLength),
      })),
    });

    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

    expect(applyChangesMock).not.toHaveBeenCalled();
    expect(showErrorMock).toHaveBeenCalledWith(
      expect.stringContaining("exceeds the 5 MiB limit"),
    );
  });

  it("applies bounded pre-existing text directly without an iframe", async () => {
    renderDialog({
      iframe: null,
      changes: [{ ...makeChange("component-a"), textContent: "Existing text" }],
    });

    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

    await waitFor(() => {
      expect(applyChangesMock).toHaveBeenCalledWith({
        appId: 1,
        changes: [
          expect.objectContaining({
            componentId: "component-a",
            textContent: "Existing text",
          }),
        ],
      });
    });
  });

  it("rejects more pending components than the cache entry budget", () => {
    const { iframe, postMessageMock } = createIframe();
    renderDialog({
      iframe,
      changes: Array.from(
        { length: MAX_VISUAL_TEXT_CACHE_ENTRIES + 1 },
        (_, index) => makeChange(`component-${index}`),
      ),
    });

    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

    expect(postMessageMock).not.toHaveBeenCalled();
    expect(applyChangesMock).not.toHaveBeenCalled();
    expect(showErrorMock).toHaveBeenCalledWith(
      expect.stringContaining(
        `more than ${MAX_VISUAL_TEXT_CACHE_ENTRIES} visual changes`,
      ),
    );
  });

  it("times out cleanly and allows a fresh retry", async () => {
    vi.useFakeTimers();
    const { iframe, iframeWindow } = createIframe();
    renderDialog({ iframe });
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

    act(() => {
      vi.advanceTimersByTime(VISUAL_TEXT_RESPONSE_TIMEOUT_MS);
    });

    expect(showErrorMock).toHaveBeenCalledWith(
      expect.stringContaining("Timed out waiting for text content"),
    );
    sendTextResponse(iframeWindow, "component-a", "Stale response");
    expect(applyChangesMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));
    sendTextResponse(iframeWindow, "component-a", "Fresh response");
    await vi.waitFor(() => expect(applyChangesMock).toHaveBeenCalledTimes(1));
    expect(applyChangesMock.mock.calls[0][0].changes[0].textContent).toBe(
      "Fresh response",
    );
  });

  it("clears partial responses when the save is discarded", async () => {
    const { iframe, iframeWindow } = createIframe();
    const changes = [makeChange("component-a"), makeChange("component-b")];
    const { store } = renderDialog({ iframe, changes });
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));
    sendTextResponse(iframeWindow, "component-a", "Discarded text");

    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    sendTextResponse(iframeWindow, "component-b", "Late text");
    expect(applyChangesMock).not.toHaveBeenCalled();

    act(() => {
      store.set(
        pendingVisualChangesAtom,
        new Map(changes.map((change) => [change.componentId, change])),
      );
    });
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));
    sendTextResponse(iframeWindow, "component-b", "Fresh B");
    expect(applyChangesMock).not.toHaveBeenCalled();
    sendTextResponse(iframeWindow, "component-a", "Fresh A");

    await waitFor(() => expect(applyChangesMock).toHaveBeenCalledTimes(1));
    expect(applyChangesMock.mock.calls[0][0].changes).toEqual([
      expect.objectContaining({ textContent: "Fresh A" }),
      expect.objectContaining({ textContent: "Fresh B" }),
    ]);
  });

  it("clears partial responses when the selected app changes", async () => {
    const { iframe, iframeWindow } = createIframe();
    const changes = [makeChange("component-a"), makeChange("component-b")];
    const { store } = renderDialog({ iframe, changes });
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));
    sendTextResponse(iframeWindow, "component-a", "Old app text");

    act(() => store.set(selectedAppIdAtom, 2));
    sendTextResponse(iframeWindow, "component-b", "Late old app text");
    expect(applyChangesMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));
    sendTextResponse(iframeWindow, "component-a", "New app A");
    sendTextResponse(iframeWindow, "component-b", "New app B");

    await waitFor(() => expect(applyChangesMock).toHaveBeenCalledTimes(1));
    expect(applyChangesMock).toHaveBeenCalledWith(
      expect.objectContaining({ appId: 2 }),
    );
  });

  it("keeps save disabled until an invalidated apply call settles", async () => {
    let resolveApply: (() => void) | undefined;
    applyChangesMock.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        resolveApply = resolve;
      }),
    );
    const { iframe, iframeWindow } = createIframe();
    const { store } = renderDialog({ iframe });

    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));
    sendTextResponse(iframeWindow, "component-a", "Saved text");
    await waitFor(() => expect(applyChangesMock).toHaveBeenCalledTimes(1));

    act(() => store.set(selectedAppIdAtom, 2));
    const savingButton = screen.getByRole("button", { name: "Saving..." });
    expect((savingButton as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(savingButton);
    expect(applyChangesMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveApply?.();
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(
        (
          screen.getByRole("button", {
            name: "Save Changes",
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(false);
    });
    expect(store.get(pendingVisualChangesAtom).size).toBe(1);
    expect(showSuccessMock).not.toHaveBeenCalled();
  });

  it("preserves edits added or replaced while apply is in flight", async () => {
    let resolveApply: (() => void) | undefined;
    applyChangesMock.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        resolveApply = resolve;
      }),
    );
    const originalChange = makeChange("component-a");
    const { iframe, iframeWindow } = createIframe();
    const { store, onReset } = renderDialog({
      iframe,
      changes: [originalChange],
    });

    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));
    sendTextResponse(iframeWindow, "component-a", "Saved text");
    await waitFor(() => expect(applyChangesMock).toHaveBeenCalledTimes(1));

    const newerSameComponent = {
      ...originalChange,
      textContent: "Newer text",
    };
    const newComponent = makeChange("component-b");
    act(() => {
      store.set(
        pendingVisualChangesAtom,
        new Map([
          [newerSameComponent.componentId, newerSameComponent],
          [newComponent.componentId, newComponent],
        ]),
      );
    });

    await act(async () => {
      resolveApply?.();
      await Promise.resolve();
    });

    expect(store.get(pendingVisualChangesAtom)).toEqual(
      new Map([
        [newerSameComponent.componentId, newerSameComponent],
        [newComponent.componentId, newComponent],
      ]),
    );
    expect(showSuccessMock).toHaveBeenCalledTimes(1);
    expect(onReset).not.toHaveBeenCalled();
  });

  it("uses the latest onReset callback without replacing the message listener", async () => {
    const addEventListenerSpy = vi.spyOn(window, "addEventListener");
    const firstOnReset = vi.fn();
    const latestOnReset = vi.fn();
    const { iframe, iframeWindow } = createIframe();
    const { iframeRef, rerender } = renderDialog({
      iframe,
      onReset: firstOnReset,
    });
    const initialMessageListenerAdds = addEventListenerSpy.mock.calls.filter(
      ([eventName]) => eventName === "message",
    ).length;

    rerender(
      <VisualEditingChangesDialog
        iframeRef={iframeRef}
        onReset={latestOnReset}
      />,
    );
    expect(
      addEventListenerSpy.mock.calls.filter(
        ([eventName]) => eventName === "message",
      ).length,
    ).toBe(initialMessageListenerAdds);

    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));
    sendTextResponse(iframeWindow, "component-a", "Saved text");
    await waitFor(() => expect(latestOnReset).toHaveBeenCalledTimes(1));
    expect(firstOnReset).not.toHaveBeenCalled();
    addEventListenerSpy.mockRestore();
  });

  it("shows a readable message for structured apply errors", async () => {
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    applyChangesMock.mockRejectedValueOnce({ message: "Structured failure" });
    renderDialog({ iframe: null });

    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

    await waitFor(() => {
      expect(showErrorMock).toHaveBeenCalledWith(
        "Failed to save changes: Structured failure",
      );
    });
    consoleErrorSpy.mockRestore();
  });

  it("clears partial responses when the iframe is replaced", async () => {
    const first = createIframe();
    const second = createIframe();
    const changes = [makeChange("component-a"), makeChange("component-b")];
    const { iframeRef, rerender } = renderDialog({
      iframe: first.iframe,
      changes,
    });
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));
    sendTextResponse(first.iframeWindow, "component-a", "Old iframe text");

    iframeRef.current = second.iframe;
    rerender(
      <VisualEditingChangesDialog iframeRef={iframeRef} onReset={vi.fn()} />,
    );
    sendTextResponse(first.iframeWindow, "component-b", "Late old text");
    expect(applyChangesMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));
    sendTextResponse(second.iframeWindow, "component-a", "New iframe A");
    sendTextResponse(second.iframeWindow, "component-b", "New iframe B");
    await waitFor(() => expect(applyChangesMock).toHaveBeenCalledTimes(1));
  });

  it("clears pending request state and its timeout on unmount", () => {
    vi.useFakeTimers();
    const { iframe, iframeWindow } = createIframe();
    const { unmount } = renderDialog({
      iframe,
      changes: [makeChange("component-a"), makeChange("component-b")],
    });
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));
    sendTextResponse(iframeWindow, "component-a", "Cached before unmount");

    unmount();
    expect(vi.getTimerCount()).toBe(0);
    sendTextResponse(iframeWindow, "component-b", "Late after unmount");
    act(() => {
      vi.advanceTimersByTime(VISUAL_TEXT_RESPONSE_TIMEOUT_MS);
    });

    expect(applyChangesMock).not.toHaveBeenCalled();
    expect(showErrorMock).not.toHaveBeenCalled();
  });
});
