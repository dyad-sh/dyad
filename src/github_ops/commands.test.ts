import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GithubOpsEvent } from "./state";
import { GithubOpsCommandRunner } from "./commands";

const { getConflictsMock, getGitStateMock, pushMock, showErrorMock } =
  vi.hoisted(() => ({
    getConflictsMock: vi.fn(),
    getGitStateMock: vi.fn(),
    pushMock: vi.fn(),
    showErrorMock: vi.fn(),
  }));

vi.mock("@/ipc/types", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/ipc/types")>()),
  ipc: {
    github: {
      getConflicts: getConflictsMock,
      getGitState: getGitStateMock,
      push: pushMock,
    },
  },
}));

vi.mock("@/lib/toast", () => ({
  showError: showErrorMock,
  showInfo: vi.fn(),
  showSuccess: vi.fn(),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function flushPromises(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function setup() {
  const runner = new GithubOpsCommandRunner(
    new QueryClient({
      defaultOptions: { queries: { retry: false } },
    }),
  );
  const events: GithubOpsEvent[] = [];
  const emit = (event: GithubOpsEvent) => events.push(event);
  return { emit, events, runner };
}

describe("GithubOpsCommandRunner probes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("drops conflict results superseded by a newer probe", async () => {
    const older = deferred<string[]>();
    const newer = deferred<string[]>();
    getConflictsMock
      .mockReturnValueOnce(older.promise)
      .mockReturnValueOnce(newer.promise);
    const { emit, events, runner } = setup();

    runner.run(7, { type: "probe-conflicts" }, emit);
    runner.run(7, { type: "probe-conflicts" }, emit);
    newer.resolve(["src/current.ts"]);
    await flushPromises();
    older.resolve([]);
    await flushPromises();

    expect(events).toEqual([{ type: "CONFLICTS", files: ["src/current.ts"] }]);
  });

  it("invalidates outstanding probes when an operation starts", async () => {
    const gitState = deferred<{
      mergeInProgress: boolean;
      rebaseInProgress: boolean;
    }>();
    const push = deferred<void>();
    getGitStateMock.mockReturnValue(gitState.promise);
    pushMock.mockReturnValue(push.promise);
    const { emit, events, runner } = setup();

    runner.run(7, { type: "probe-git-state" }, emit);
    runner.run(
      7,
      { type: "run-op", op: { type: "push", mode: "normal" } },
      emit,
    );
    push.resolve();
    await flushPromises();
    gitState.resolve({ mergeInProgress: false, rebaseInProgress: true });
    await flushPromises();

    expect(events).toEqual([
      {
        type: "OP_SUCCEEDED",
        op: { type: "push", mode: "normal" },
      },
    ]);
  });

  it("preserves state on reconcile probe failure but settles coded failures", async () => {
    getConflictsMock
      .mockRejectedValueOnce(new Error("reconcile failed"))
      .mockRejectedValueOnce(new Error("failure probe failed"));
    const { emit, events, runner } = setup();

    runner.run(7, { type: "probe-conflicts" }, emit);
    await flushPromises();
    expect(events).toEqual([]);

    runner.run(7, { type: "probe-conflicts", settleOnError: true }, emit);
    await flushPromises();
    expect(events).toEqual([{ type: "CONFLICTS", files: [] }]);
    expect(showErrorMock).toHaveBeenCalledTimes(2);
  });
});
