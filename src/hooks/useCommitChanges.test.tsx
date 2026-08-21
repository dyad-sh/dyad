import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GIT_ERROR_CODES } from "@/shared/git_error_codes";
import type { CommitProgress } from "@/ipc/types/github";
import { useCommitChanges } from "./useCommitChanges";

const mocks = vi.hoisted(() => ({
  cancelCommit: vi.fn(),
  commitChanges: vi.fn(),
  commitProgressListeners: new Set<(progress: CommitProgress) => void>(),
  onCommitProgress: vi.fn((listener: (progress: CommitProgress) => void) => {
    mocks.commitProgressListeners.add(listener);
    return () => mocks.commitProgressListeners.delete(listener);
  }),
  requestCapture: vi.fn(),
  showError: vi.fn(),
  showSuccess: vi.fn(),
}));

vi.mock("@/ipc/types", () => ({
  ipc: {
    git: {
      cancelCommit: mocks.cancelCommit,
      commitChanges: mocks.commitChanges,
    },
    events: { git: { onCommitProgress: mocks.onCommitProgress } },
  },
}));
vi.mock("@/screenshot/ScreenshotProvider", () => ({
  useScreenshotManager: () => ({ requestCapture: mocks.requestCapture }),
}));
vi.mock("@/lib/toast", () => ({
  showError: mocks.showError,
  showSuccess: mocks.showSuccess,
}));

let queryClient: QueryClient;

function Wrapper({ children }: PropsWithChildren) {
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

describe("useCommitChanges", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.commitProgressListeners.clear();
    queryClient = new QueryClient();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("exposes a coded pre-commit failure for the inline AI action", async () => {
    const error = Object.assign(new Error("lint failed"), {
      code: GIT_ERROR_CODES.PRE_COMMIT_FAILED,
    });
    mocks.commitChanges.mockRejectedValueOnce(error);
    const { result } = renderHook(() => useCommitChanges(), {
      wrapper: Wrapper,
    });

    await act(async () => {
      await expect(
        result.current.commitChanges({ appId: 7, message: "Save work" }),
      ).rejects.toBe(error);
    });

    await waitFor(() => expect(result.current.preCommitError).toBe(error));
    expect(mocks.showError).not.toHaveBeenCalled();
  });

  it("exposes a coded commit-msg failure inline instead of in a toast", async () => {
    const error = Object.assign(
      new Error("subject may not be empty [subject-empty]"),
      { code: GIT_ERROR_CODES.COMMIT_MSG_FAILED },
    );
    mocks.commitChanges.mockRejectedValueOnce(error);
    const { result } = renderHook(() => useCommitChanges(), {
      wrapper: Wrapper,
    });

    await act(async () => {
      await expect(
        result.current.commitChanges({ appId: 7, message: "Save work" }),
      ).rejects.toBe(error);
    });

    await waitFor(() => expect(result.current.commitMsgError).toBe(error));
    expect(result.current.preCommitError).toBeNull();
    expect(mocks.showError).not.toHaveBeenCalled();
  });

  it("refetches the file list when a hook fails after rewriting the tree", async () => {
    // lint-staged and friends reformat and re-stage files before exiting
    // non-zero, so the still-open dialog would otherwise keep rendering the
    // pre-hook file list and diffs.
    const invalidateQueries = vi.spyOn(
      QueryClient.prototype,
      "invalidateQueries",
    );
    const error = Object.assign(new Error("lint failed"), {
      code: GIT_ERROR_CODES.PRE_COMMIT_FAILED,
    });
    mocks.commitChanges.mockRejectedValueOnce(error);
    const { result } = renderHook(() => useCommitChanges(), {
      wrapper: Wrapper,
    });

    await act(async () => {
      await expect(
        result.current.commitChanges({ appId: 7, message: "Save work" }),
      ).rejects.toBe(error);
    });

    await waitFor(() =>
      expect(invalidateQueries).toHaveBeenCalledWith({
        queryKey: ["uncommittedFiles", 7],
      }),
    );
  });

  it("keeps unrelated commit failures on the existing toast path", async () => {
    const error = new Error("repository unavailable");
    mocks.commitChanges.mockRejectedValueOnce(error);
    const { result } = renderHook(() => useCommitChanges(), {
      wrapper: Wrapper,
    });

    await act(async () => {
      await expect(
        result.current.commitChanges({ appId: 7, message: "Save work" }),
      ).rejects.toBe(error);
    });

    await waitFor(() =>
      expect(mocks.showError).toHaveBeenCalledWith(
        "Failed to commit: repository unavailable",
      ),
    );
    expect(result.current.preCommitError).toBeNull();
  });

  it("tracks only progress for the active commit operation", async () => {
    let resolveCommit!: (hash: string) => void;
    mocks.commitChanges.mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          resolveCommit = resolve;
        }),
    );
    const { result } = renderHook(() => useCommitChanges(), {
      wrapper: Wrapper,
    });

    let commitPromise!: Promise<string>;
    act(() => {
      commitPromise = result.current.commitChanges({
        appId: 7,
        message: "Save work",
      });
    });
    await waitFor(() => expect(mocks.commitChanges).toHaveBeenCalledOnce());
    const { operationId } = mocks.commitChanges.mock.calls[0][0];

    act(() => {
      for (const listener of mocks.commitProgressListeners) {
        listener({
          appId: 7,
          operationId: "another-operation",
          phase: "staging",
        });
      }
    });
    expect(result.current.commitProgress).toBeNull();

    act(() => {
      for (const listener of mocks.commitProgressListeners) {
        listener({ appId: 7, operationId, phase: "pre-commit" });
      }
    });
    expect(result.current.commitProgress?.phase).toBe("pre-commit");

    await act(async () => {
      resolveCommit("commit-hash");
      await commitPromise;
    });
    expect(result.current.commitProgress).toBeNull();
  });

  it("reuses an identical in-flight request and rejects a different one", async () => {
    let resolveCommit!: (hash: string) => void;
    mocks.commitChanges.mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          resolveCommit = resolve;
        }),
    );
    const { result } = renderHook(() => useCommitChanges(), {
      wrapper: Wrapper,
    });

    let first!: Promise<string>;
    let duplicate!: Promise<string>;
    act(() => {
      first = result.current.commitChanges({ appId: 7, message: "Save work" });
      duplicate = result.current.commitChanges({
        appId: 7,
        message: "Save work",
      });
    });

    expect(duplicate).toBe(first);
    await expect(
      result.current.commitChanges({ appId: 8, message: "Other work" }),
    ).rejects.toThrow("Another commit is already in progress");
    expect(mocks.showError).toHaveBeenCalledWith(
      "Another commit is already in progress.",
    );
    expect(mocks.commitChanges).toHaveBeenCalledOnce();

    await act(async () => {
      resolveCommit("commit-hash");
      await first;
    });
  });

  it("cancels the active operation without showing a failure toast", async () => {
    let rejectCommit!: (error: Error) => void;
    mocks.commitChanges.mockImplementationOnce(
      () =>
        new Promise<string>((_resolve, reject) => {
          rejectCommit = reject;
        }),
    );
    mocks.cancelCommit.mockResolvedValueOnce(true);
    const { result } = renderHook(() => useCommitChanges(), {
      wrapper: Wrapper,
    });

    let commitPromise!: Promise<string>;
    act(() => {
      commitPromise = result.current.commitChanges({
        appId: 7,
        message: "Save work",
      });
    });
    await waitFor(() => expect(mocks.commitChanges).toHaveBeenCalledOnce());
    const { operationId } = mocks.commitChanges.mock.calls[0][0];

    await act(async () => {
      await result.current.cancelCommit();
    });
    expect(mocks.cancelCommit).toHaveBeenCalledWith({ appId: 7, operationId });

    const cancelled = Object.assign(new Error("cancelled"), {
      code: GIT_ERROR_CODES.COMMIT_CANCELLED,
    });
    await act(async () => {
      rejectCommit(cancelled);
      await expect(commitPromise).rejects.toBe(cancelled);
    });
    expect(mocks.showError).not.toHaveBeenCalled();
  });

  it("reports when cancellation arrives after the operation finished", async () => {
    let resolveCommit!: (hash: string) => void;
    mocks.commitChanges.mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          resolveCommit = resolve;
        }),
    );
    mocks.cancelCommit.mockResolvedValueOnce(false);
    const { result } = renderHook(() => useCommitChanges(), {
      wrapper: Wrapper,
    });

    let commitPromise!: Promise<string>;
    act(() => {
      commitPromise = result.current.commitChanges({
        appId: 7,
        message: "Save work",
      });
    });
    await waitFor(() => expect(mocks.commitChanges).toHaveBeenCalledOnce());

    await act(async () => {
      await result.current.cancelCommit();
    });

    expect(result.current.isCancellingCommit).toBe(false);
    expect(mocks.showError).toHaveBeenCalledWith(
      "The commit is already finishing and cannot be cancelled.",
    );

    await act(async () => {
      resolveCommit("commit-hash");
      await commitPromise;
    });
  });
});
