import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PropsWithChildren } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { selectedAppIdAtom } from "@/atoms/appAtoms";
import { pendingVisualChangesAtom } from "@/atoms/previewAtoms";
import { VisualEditingChangesDialog } from "./VisualEditingChangesDialog";

const mocks = vi.hoisted(() => ({
  applyChanges: vi.fn(),
  showError: vi.fn(),
  showSuccess: vi.fn(),
}));

vi.mock("@/ipc/types", () => ({
  ipc: {
    visualEditing: {
      applyChanges: mocks.applyChanges,
    },
  },
}));

vi.mock("@/lib/toast", () => ({
  showError: mocks.showError,
  showSuccess: mocks.showSuccess,
}));

describe("VisualEditingChangesDialog", () => {
  beforeEach(() => {
    mocks.applyChanges.mockReset();
    mocks.showError.mockReset();
    mocks.showSuccess.mockReset();
  });

  it("applies pending changes once when the component rerenders during save", async () => {
    let resolveApplyChanges: (() => void) | undefined;
    mocks.applyChanges.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveApplyChanges = resolve;
        }),
    );

    const store = createStore();
    store.set(selectedAppIdAtom, 1);
    store.set(
      pendingVisualChangesAtom,
      new Map([
        [
          "src/pages/Index.tsx:7",
          {
            componentId: "src/pages/Index.tsx:7",
            componentName: "h1",
            relativePath: "src/pages/Index.tsx",
            lineNumber: 7,
            styles: {
              margin: { left: "20px", right: "20px" },
            },
          },
        ],
      ]),
    );

    const queryClient = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    });
    const Wrapper = ({ children }: PropsWithChildren) => (
      <QueryClientProvider client={queryClient}>
        <Provider store={store}>{children}</Provider>
      </QueryClientProvider>
    );

    const view = render(
      <VisualEditingChangesDialog onReset={() => undefined} />,
      { wrapper: Wrapper },
    );

    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

    await waitFor(() => expect(mocks.applyChanges).toHaveBeenCalledTimes(1));

    view.rerender(<VisualEditingChangesDialog onReset={() => undefined} />);

    await act(async () => {
      await Promise.resolve();
    });
    expect(mocks.applyChanges).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveApplyChanges?.();
    });

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Save Changes" })).toBeNull();
    });
    expect(mocks.showSuccess).toHaveBeenCalledTimes(1);
  });
});
