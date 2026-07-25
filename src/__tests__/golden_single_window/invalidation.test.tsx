import { act, renderHook } from "@testing-library/react";
import {
  QueryClient,
  QueryClientProvider,
  type QueryKey,
} from "@tanstack/react-query";
import { createStore, Provider } from "jotai";
import type { PropsWithChildren } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { selectedAppIdAtom } from "@/atoms/appAtoms";
import { queryKeys } from "@/lib/queryKeys";
import { useCreateApp } from "@/hooks/useCreateApp";
import { useRenameBranch } from "@/hooks/useRenameBranch";
import { createVersionPreviewRuntime } from "@/version_preview/commands";

const mocks = vi.hoisted(() => ({
  checkoutVersion: vi.fn(),
  createApp: vi.fn(),
  renameBranch: vi.fn(),
  revertVersion: vi.fn(),
}));

vi.mock("@/ipc/types", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/ipc/types")>();
  return {
    ...original,
    ipc: {
      ...original.ipc,
      app: {
        ...original.ipc.app,
        createApp: mocks.createApp,
        renameBranch: mocks.renameBranch,
      },
      version: {
        ...original.ipc.version,
        checkoutVersion: mocks.checkoutVersion,
        revertVersion: mocks.revertVersion,
      },
    },
  };
});

vi.mock("@/lib/toast", () => ({
  showError: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
    dismiss: vi.fn(),
  },
}));

function setup() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false },
    },
  });
  const store = createStore();
  store.set(selectedAppIdAtom, 7);
  const invalidations: QueryKey[] = [];
  const originalInvalidate = queryClient.invalidateQueries.bind(queryClient);
  vi.spyOn(queryClient, "invalidateQueries").mockImplementation((filters) => {
    invalidations.push(filters?.queryKey ?? []);
    return originalInvalidate(filters);
  });

  function Wrapper({ children }: PropsWithChildren) {
    return (
      <QueryClientProvider client={queryClient}>
        <Provider store={store}>{children}</Provider>
      </QueryClientProvider>
    );
  }

  return { invalidations, queryClient, store, Wrapper };
}

describe("golden single-window: local invalidation counts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createApp.mockResolvedValue({ appId: 7, chatId: 11 });
    mocks.renameBranch.mockResolvedValue(undefined);
    mocks.revertVersion.mockResolvedValue({
      repositoryOutcome: "target-applied",
      notification: null,
      runtimeAction: "none",
      affectedChatId: null,
      createdChatId: null,
    });
    mocks.checkoutVersion.mockResolvedValue({
      repositoryOutcome: "target-applied",
      notification: null,
      runtimeAction: "none",
      affectedChatId: null,
      createdChatId: null,
    });
  });

  it("app creation invalidates apps and chats exactly once each", async () => {
    const { invalidations, Wrapper } = setup();
    const { result } = renderHook(() => useCreateApp(), { wrapper: Wrapper });

    await act(async () => {
      await result.current.createApp({ name: "Golden app" });
    });

    expect(invalidations).toEqual([queryKeys.apps.all, queryKeys.chats.all]);
  });

  it("branch rename invalidates branch and version families once each", async () => {
    const { invalidations, Wrapper } = setup();
    const { result } = renderHook(() => useRenameBranch(), {
      wrapper: Wrapper,
    });

    await act(async () => {
      await result.current.renameBranch({
        oldBranchName: "main",
        newBranchName: "trunk",
      });
    });

    expect(invalidations).toEqual([
      queryKeys.branches.byApp({ appId: 7 }),
      queryKeys.versions.list({ appId: 7 }),
    ]);
  });

  it.each(["checkout", "restore"] as const)(
    "version %s invalidates four related families exactly once",
    async (operation) => {
      const { invalidations, queryClient, store } = setup();
      const runtime = createVersionPreviewRuntime({
        queryClient,
        store,
        restartApp: vi.fn().mockResolvedValue(undefined),
      });

      if (operation === "checkout") {
        await runtime.commands.checkoutVersion({
          appId: 7,
          versionId: "abc123",
        });
      } else {
        await runtime.commands.restoreVersion({
          appId: 7,
          versionId: "abc123",
          targetBranch: null,
          expectedHeadOid: "head",
        });
      }

      expect(invalidations).toEqual([
        queryKeys.branches.byApp({ appId: 7 }),
        queryKeys.versions.list({ appId: 7 }),
        queryKeys.apps.detail({ appId: 7 }),
        queryKeys.problems.byApp({ appId: 7 }),
      ]);
    },
  );
});
