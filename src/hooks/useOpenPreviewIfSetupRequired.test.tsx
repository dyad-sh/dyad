import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createStore, Provider } from "jotai";
import type { PropsWithChildren } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { previewModeAtom } from "@/atoms/appAtoms";
import { isPreviewOpenAtom } from "@/atoms/viewAtoms";
import { useOpenPreviewIfSetupRequired } from "./useOpenPreviewIfSetupRequired";

const mocks = vi.hoisted(() => ({
  getNodejsStatus: vi.fn(),
}));

vi.mock("@/ipc/types", () => ({
  ipc: {
    system: {
      getNodejsStatus: mocks.getNodejsStatus,
    },
  },
}));

describe("useOpenPreviewIfSetupRequired", () => {
  beforeEach(() => {
    mocks.getNodejsStatus.mockReset();
  });

  it("opens the preview panel when preview mode would show Node setup", async () => {
    mocks.getNodejsStatus.mockResolvedValue({
      nodeVersion: null,
      pnpmVersion: null,
      nodeDownloadUrl: "https://nodejs.org",
    });
    const { result, store } = renderUseOpenPreviewIfSetupRequired();

    let opened = false;
    await act(async () => {
      opened = await result.current(1);
    });

    expect(opened).toBe(true);
    expect(store.get(isPreviewOpenAtom)).toBe(true);
  });

  it("does not open the preview panel when Node is installed", async () => {
    mocks.getNodejsStatus.mockResolvedValue({
      nodeVersion: "v24.0.0",
      pnpmVersion: "10.15.0",
      nodeDownloadUrl: "https://nodejs.org",
    });
    const { result, store } = renderUseOpenPreviewIfSetupRequired();

    let opened = true;
    await act(async () => {
      opened = await result.current(1);
    });

    expect(opened).toBe(false);
    expect(store.get(isPreviewOpenAtom)).toBe(false);
  });

  it("does not open when the preview panel would show another mode", async () => {
    const { result, store } = renderUseOpenPreviewIfSetupRequired({
      previewMode: "code",
    });

    let opened = true;
    await act(async () => {
      opened = await result.current(1);
    });

    expect(opened).toBe(false);
    expect(store.get(isPreviewOpenAtom)).toBe(false);
    expect(mocks.getNodejsStatus).not.toHaveBeenCalled();
  });

  it("does not open on a refresh error when cached Node status is installed", async () => {
    mocks.getNodejsStatus.mockRejectedValue(new Error("boom"));
    const { result, store, queryClient } =
      renderUseOpenPreviewIfSetupRequired();
    queryClient.setQueryData(["system", "nodejsStatus"], {
      nodeVersion: "v24.0.0",
      pnpmVersion: "10.15.0",
      nodeDownloadUrl: "https://nodejs.org",
    });

    let opened = true;
    await act(async () => {
      opened = await result.current(1);
    });

    expect(opened).toBe(false);
    expect(store.get(isPreviewOpenAtom)).toBe(false);
  });
});

function renderUseOpenPreviewIfSetupRequired({
  previewMode = "preview",
}: {
  previewMode?: "preview" | "code";
} = {}) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });
  const store = createStore();
  store.set(previewModeAtom, previewMode);
  store.set(isPreviewOpenAtom, false);

  function Wrapper({ children }: PropsWithChildren) {
    return (
      <QueryClientProvider client={queryClient}>
        <Provider store={store}>{children}</Provider>
      </QueryClientProvider>
    );
  }

  return {
    ...renderHook(() => useOpenPreviewIfSetupRequired(), { wrapper: Wrapper }),
    queryClient,
    store,
  };
}
