import { act, cleanup, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createStore, Provider } from "jotai";
import type { PropsWithChildren } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { dismissedNeonReconnectionAppIdsAtom } from "@/atoms/neonAtoms";
import { useDeleteApp, useDeleteApps } from "./useDeleteApp";

const h = vi.hoisted(() => ({ deleteApp: vi.fn(), deleteApps: vi.fn() }));
vi.mock("@/ipc/types", () => ({ ipc: { app: h } }));

let store: ReturnType<typeof createStore>;
let client: QueryClient;
function wrapper({ children }: PropsWithChildren) {
  return (
    <Provider store={store}>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </Provider>
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  store = createStore();
  store.set(dismissedNeonReconnectionAppIdsAtom, new Set([1, 2, 3]));
  client = new QueryClient();
});
afterEach(() => {
  cleanup();
  client.clear();
});

it("clears only the deleted app's dismissal after deletion succeeds", async () => {
  let finish!: () => void;
  h.deleteApp.mockReturnValue(
    new Promise<void>((resolve) => {
      finish = resolve;
    }),
  );
  const { result } = renderHook(useDeleteApp, { wrapper });
  let deletion!: Promise<unknown>;
  await act(async () => {
    deletion = result.current.mutateAsync(1);
  });
  expect(store.get(dismissedNeonReconnectionAppIdsAtom)).toEqual(
    new Set([1, 2, 3]),
  );
  await act(async () => {
    finish();
    await deletion;
  });
  expect(h.deleteApp).toHaveBeenCalledWith({ appId: 1 });
  expect(store.get(dismissedNeonReconnectionAppIdsAtom)).toEqual(
    new Set([2, 3]),
  );
});

it("retains the dismissal when deletion fails", async () => {
  h.deleteApp.mockRejectedValue(new Error("Deletion failed"));
  const { result } = renderHook(useDeleteApp, { wrapper });
  await act(async () => {
    await expect(result.current.mutateAsync(1)).rejects.toThrow(
      "Deletion failed",
    );
  });
  expect(store.get(dismissedNeonReconnectionAppIdsAtom)).toEqual(
    new Set([1, 2, 3]),
  );
});

it("clears successful bulk deletions while retaining failed and unrelated apps", async () => {
  h.deleteApps.mockResolvedValue({
    results: [
      { appId: 1, success: true },
      { appId: 2, success: false },
    ],
  });
  const { result } = renderHook(useDeleteApps, { wrapper });
  await act(async () => {
    await result.current.mutateAsync([1, 2]);
  });
  expect(h.deleteApps).toHaveBeenCalledWith({ appIds: [1, 2] });
  expect(store.get(dismissedNeonReconnectionAppIdsAtom)).toEqual(
    new Set([2, 3]),
  );
});
