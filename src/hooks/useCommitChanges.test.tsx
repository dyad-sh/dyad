import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { GIT_ERROR_CODES } from "@/shared/git_error_codes";
import type { CommitProgress } from "@/ipc/types/github";
import { useCommitChanges } from "./useCommitChanges";

const mocks = vi.hoisted(() => ({
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
    git: { commitChanges: mocks.commitChanges },
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

function Wrapper({ children }: PropsWithChildren) {
  return (
    <QueryClientProvider client={new QueryClient()}>
      {children}
    </QueryClientProvider>
  );
}

describe("useCommitChanges", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.commitProgressListeners.clear();
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
});
