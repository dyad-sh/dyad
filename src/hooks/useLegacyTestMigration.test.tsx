import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { queryKeys } from "@/lib/queryKeys";
import {
  useLegacyTests,
  useMigrateLegacyTests,
} from "./useLegacyTestMigration";

const detectLegacyTestsMock = vi.hoisted(() => vi.fn());
const migrateLegacyTestsMock = vi.hoisted(() => vi.fn());

vi.mock("@/ipc/types", () => ({
  ipc: {
    tests: {
      detectLegacyTests: detectLegacyTestsMock,
      migrateLegacyTests: migrateLegacyTestsMock,
    },
  },
}));

function makeWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: PropsWithChildren) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

function makeClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

describe("useLegacyTests", () => {
  beforeEach(() => {
    detectLegacyTestsMock.mockReset();
  });

  it("does not query when appId is null", async () => {
    const queryClient = makeClient();
    const { result } = renderHook(() => useLegacyTests(null, true), {
      wrapper: makeWrapper(queryClient),
    });
    // Disabled query never fetches.
    expect(result.current.fetchStatus).toBe("idle");
    expect(result.current.data).toBeUndefined();
    expect(detectLegacyTestsMock).not.toHaveBeenCalled();
  });

  it("does not query when disabled", async () => {
    const queryClient = makeClient();
    renderHook(() => useLegacyTests(42, false), {
      wrapper: makeWrapper(queryClient),
    });
    expect(detectLegacyTestsMock).not.toHaveBeenCalled();
  });

  it("fetches detected legacy specs when enabled", async () => {
    const queryClient = makeClient();
    detectLegacyTestsMock.mockResolvedValue({
      files: [{ file: "tests/a.spec.ts", targetExists: false }],
    });
    const { result } = renderHook(() => useLegacyTests(42, true), {
      wrapper: makeWrapper(queryClient),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(detectLegacyTestsMock).toHaveBeenCalledWith({ appId: 42 });
    expect(result.current.data?.files).toEqual([
      { file: "tests/a.spec.ts", targetExists: false },
    ]);
  });
});

describe("useMigrateLegacyTests", () => {
  beforeEach(() => {
    migrateLegacyTestsMock.mockReset();
  });

  it("invalidates both the spec list and legacy detection on success", async () => {
    const queryClient = makeClient();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    migrateLegacyTestsMock.mockResolvedValue({
      results: [
        { file: "tests/a.spec.ts", ok: true, movedTo: "e2e-tests/a.spec.ts" },
      ],
      movedSupportFiles: [],
      skippedSupportFiles: [],
    });

    const { result } = renderHook(() => useMigrateLegacyTests(), {
      wrapper: makeWrapper(queryClient),
    });

    await act(async () => {
      await result.current.mutateAsync({
        appId: 42,
        files: ["tests/a.spec.ts"],
      });
    });

    expect(migrateLegacyTestsMock).toHaveBeenCalledWith({
      appId: 42,
      files: ["tests/a.spec.ts"],
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: queryKeys.tests.list({ appId: 42 }),
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: queryKeys.tests.legacy({ appId: 42 }),
    });
  });
});
