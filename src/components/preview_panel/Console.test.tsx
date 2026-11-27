import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createStore, Provider } from "jotai";
import { selectedAppIdAtom } from "@/atoms/appAtoms";
import type { ConsoleEntry } from "@/ipc/types";
import { Console } from "./Console";

const h = vi.hoisted(() => ({
  entries: [] as ConsoleEntry[],
  observers: [] as {
    callback: ResizeObserverCallback;
    targets: Element[];
  }[],
}));

vi.mock("@/hooks/useSettings", () => ({
  useSettings: () => ({ settings: { isTestMode: true } }),
}));
vi.mock("@/preview_console/hooks", () => ({
  useConsoleEntries: () => h.entries,
}));
vi.mock("@/app_run/AppRunRemoteProvider", () => ({
  useAppRunRemoteManager: () => ({ previewConsole: { clear: vi.fn() } }),
}));
vi.mock("./ConsoleFilters", () => ({ ConsoleFilters: () => null }));
vi.mock("./SupabaseEdgeLogPollingHint", () => ({
  SupabaseEdgeLogPollingHint: () => <p>Polling hint</p>,
}));

beforeEach(() => {
  h.entries = [
    {
      level: "info",
      type: "client",
      message: "hello",
      timestamp: 1,
      appId: 1,
    },
  ];
  h.observers = [];
  vi.stubGlobal(
    "ResizeObserver",
    class {
      private readonly record: (typeof h.observers)[number];
      constructor(callback: ResizeObserverCallback) {
        this.record = { callback, targets: [] };
        h.observers.push(this.record);
      }
      observe(target: Element) {
        this.record.targets.push(target);
      }
      unobserve() {}
      disconnect() {}
    },
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** Reports a height for each observed element, outermost first. */
function resize(...heights: number[]) {
  const [observer] = h.observers;
  act(() =>
    observer.callback(
      observer.targets.map(
        (target, index) =>
          ({
            target,
            contentRect: { height: heights[index] },
          }) as unknown as ResizeObserverEntry,
      ),
      observer as unknown as ResizeObserver,
    ),
  );
}

it("sizes the log list to the space left below the notices", () => {
  const store = createStore();
  store.set(selectedAppIdAtom, 1);
  render(
    <Provider store={store}>
      <Console
        supabaseProjectId="proj-1"
        supabaseOrganizationSlug="org-1"
        edgeLogsWarning="Some logs are not shown"
      />
    </Provider>,
  );
  expect(screen.getByText("Polling hint")).toBeTruthy();
  expect(screen.getByRole("status").textContent).toBe(
    "Some logs are not shown",
  );

  // The whole console is 400px; the notices leave 290px for the list.
  resize(400, 290);
  const list = screen.getByText("hello").closest("[style]") as HTMLElement;
  expect(list.style.height).toBe("290px");
});
