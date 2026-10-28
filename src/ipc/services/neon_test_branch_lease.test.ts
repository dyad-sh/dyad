import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  remove: vi.fn(),
  row: vi.fn(),
  marker: vi.fn(),
}));
vi.mock("@/db", () => ({ db: { query: { apps: { findFirst: mocks.row } } } }));
vi.mock("../utils/neon_test_branch", () => ({
  createTempTestBranch: mocks.create,
  markAndDeleteTempTestBranch: mocks.remove,
  trackedRunTestBranchId: mocks.marker,
}));
import {
  acquireNeonTestBranch,
  isNeonBranchCapacityError,
} from "./neon_test_branch_lease";
import type { apps } from "@/db/schema";
const app = {
  id: 1,
  neonProjectId: "project",
  neonActiveBranchId: "parent",
  neonTestBranchId: null,
} as typeof apps.$inferSelect;
const capacityError = {
  response: {
    status: 422,
    data: {
      code: "BRANCHES_LIMIT_EXCEEDED",
      message: "branches limit exceeded",
    },
  },
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
const acquire = (owner: string, signal?: AbortSignal, onCapacity = vi.fn()) =>
  acquireNeonTestBranch(app, `/sandbox/${owner}`, owner, {
    signal,
    onCapacity,
  });
beforeEach(() => {
  vi.resetAllMocks();
  mocks.row.mockResolvedValue(app);
  mocks.create.mockImplementation(async (_app, { ownerId }) => ({
    branchId: ownerId,
    databaseUrl: `postgres://${ownerId}`,
  }));
  mocks.remove.mockResolvedValue(true);
  mocks.marker.mockResolvedValue(null);
});

it("gives overlapping runs different branches and releases only their own branches", async () => {
  const [first, second] = await Promise.all([acquire("one"), acquire("two")]);
  expect(first.branch.branchId).toBe("one");
  expect(second.branch.branchId).toBe("two");
  await first.release();
  await first.release();
  expect(mocks.remove).toHaveBeenCalledExactlyOnceWith(app, "one");
  await second.release();
  expect(mocks.remove).toHaveBeenLastCalledWith(app, "two");
});

it("queues on the plan limit, and retries only after remote deletion settles", async () => {
  const first = await acquire("one");
  mocks.create.mockRejectedValueOnce(capacityError);
  const onCapacity = vi.fn();
  const secondPromise = acquire("two", undefined, onCapacity);
  await vi.waitFor(() => expect(onCapacity).toHaveBeenCalledWith("waiting"));
  const deletion = deferred<boolean>();
  mocks.remove.mockReturnValueOnce(deletion.promise);
  const releasing = first.release();
  await Promise.resolve();
  expect(mocks.create).toHaveBeenCalledTimes(2);
  deletion.resolve(true);
  await releasing;
  const second = await secondPromise;
  expect(second.branch.branchId).toBe("two");
  expect(onCapacity).toHaveBeenLastCalledWith(undefined);
  await second.release();
});

it("preserves FIFO and lets a queued run stop without waiting for the preceding run", async () => {
  const first = await acquire("one");
  mocks.create.mockRejectedValueOnce(capacityError);
  const waiting = vi.fn();
  const secondPromise = acquire("two", undefined, waiting);
  await vi.waitFor(() => expect(waiting).toHaveBeenCalledWith("waiting"));
  const controller = new AbortController();
  const thirdPromise = acquire("three", controller.signal);
  const stopped = expect(thirdPromise).rejects.toThrow("Stopped");
  controller.abort(new Error("Stopped"));
  await stopped;
  const fourthPromise = acquire("four");
  await first.release();
  const second = await secondPromise;
  const fourth = await fourthPromise;
  expect(mocks.create.mock.calls.map(([, options]) => options.ownerId)).toEqual(
    ["one", "two", "two", "four"],
  );
  await second.release();
  await fourth.release();
});

it("reports capacity waits for all FIFO followers, including later arrivals", async () => {
  const first = await acquire("one");
  const rejected = deferred<void>();
  mocks.create.mockImplementationOnce(async () => {
    await rejected.promise;
    throw capacityError;
  });
  const secondNotice = vi.fn();
  const thirdNotice = vi.fn();
  const fourthNotice = vi.fn();
  const controller = new AbortController();
  const secondPending = acquire("two", undefined, secondNotice);
  const thirdPending = acquire("three", controller.signal, thirdNotice);
  await vi.waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(2));
  expect(secondNotice).not.toHaveBeenCalled();
  expect(thirdNotice).not.toHaveBeenCalled();
  rejected.resolve();
  await vi.waitFor(() =>
    expect(thirdNotice).toHaveBeenCalledExactlyOnceWith("waiting"),
  );
  expect(secondNotice).toHaveBeenCalledExactlyOnceWith("waiting");
  const fourthPending = acquire("four", undefined, fourthNotice);
  expect(fourthNotice).toHaveBeenCalledExactlyOnceWith("waiting");
  expect(mocks.create).toHaveBeenCalledTimes(2);

  const stopped = expect(thirdPending).rejects.toThrow("Stopped");
  controller.abort(new Error("Stopped"));
  await stopped;
  await first.release();
  const second = await secondPending;
  const fourth = await fourthPending;
  expect(secondNotice).toHaveBeenLastCalledWith(undefined);
  expect(fourthNotice).toHaveBeenLastCalledWith(undefined);
  expect(thirdNotice).toHaveBeenCalledExactlyOnceWith("waiting");
  expect(mocks.create.mock.calls.map(([, options]) => options.ownerId)).toEqual(
    ["one", "two", "two", "four"],
  );
  await second.release();
  await fourth.release();

  const nextNotice = vi.fn();
  const next = await acquire("next", undefined, nextNotice);
  expect(nextNotice).toHaveBeenCalledExactlyOnceWith(undefined);
  await next.release();
});

it("cancels a capacity wait without deleting the running test's branch", async () => {
  const first = await acquire("one");
  mocks.create.mockRejectedValueOnce(capacityError);
  const controller = new AbortController();
  const waiting = vi.fn();
  const pending = acquire("two", controller.signal, waiting);
  await vi.waitFor(() => expect(waiting).toHaveBeenCalledWith("waiting"));
  const stopped = expect(pending).rejects.toThrow("deadline");
  controller.abort(new Error("deadline"));
  await stopped;
  expect(mocks.remove).not.toHaveBeenCalled();
  await first.release();
});

it("drains an in-flight create before cancelling and compensates the returned branch", async () => {
  const creating = deferred<{ branchId: string; databaseUrl: string }>();
  mocks.create.mockReturnValueOnce(creating.promise);
  const controller = new AbortController();
  const pending = acquire("one", controller.signal);
  await vi.waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(1));
  controller.abort(new Error("Stopped"));
  mocks.marker.mockResolvedValueOnce("one");
  const stopped = expect(pending).rejects.toThrow("Stopped");
  creating.resolve({ branchId: "one", databaseUrl: "postgres://one" });
  await stopped;
  expect(mocks.remove).toHaveBeenCalledExactlyOnceWith(app, "one");
});

it("reports a blocked plan limit when no local run can free a branch", async () => {
  mocks.create.mockRejectedValueOnce(capacityError);
  const onCapacity = vi.fn();
  await expect(acquire("one", undefined, onCapacity)).rejects.toThrow(
    "Your Neon plan's branch limit",
  );
  expect(onCapacity).toHaveBeenCalledExactlyOnceWith("blocked");
});

it("retries when another run frees capacity while the rejection is arriving", async () => {
  const first = await acquire("one");
  const failedRequest = deferred<void>();
  mocks.create.mockImplementationOnce(async () => {
    await failedRequest.promise;
    throw capacityError;
  });
  const onCapacity = vi.fn();
  const pending = acquire("two", undefined, onCapacity);
  await vi.waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(2));
  await first.release();
  failedRequest.resolve();
  const second = await pending;
  expect(onCapacity).not.toHaveBeenCalledWith("blocked");
  expect(mocks.create).toHaveBeenCalledTimes(3);
  await second.release();
});

it("does not assume failed deletion freed capacity or wait forever after it", async () => {
  const first = await acquire("one");
  mocks.create.mockRejectedValue(capacityError);
  const onCapacity = vi.fn();
  const pending = acquire("two", undefined, onCapacity);
  await vi.waitFor(() => expect(onCapacity).toHaveBeenCalledWith("waiting"));
  const rejected = expect(pending).rejects.toThrow("no active test run");
  mocks.remove.mockResolvedValueOnce(false);
  expect(await first.release()).toBe(false);
  await rejected;
  expect(onCapacity).toHaveBeenLastCalledWith("blocked");
  expect(mocks.create).toHaveBeenCalledTimes(3);
});

it("does not serialize independent Neon projects behind a capacity wait", async () => {
  const first = await acquire("one");
  mocks.create.mockRejectedValueOnce(capacityError);
  const waiting = vi.fn();
  const secondPromise = acquire("two", undefined, waiting);
  await vi.waitFor(() => expect(waiting).toHaveBeenCalledWith("waiting"));
  const otherApp = { ...app, id: 2, neonProjectId: "other-project" };
  mocks.row.mockResolvedValueOnce(otherApp);
  const otherNotice = vi.fn();
  const other = await acquireNeonTestBranch(
    otherApp,
    "/sandbox/other",
    "other",
    { onCapacity: otherNotice },
  );
  expect(other.branch.branchId).toBe("other");
  expect(otherNotice).toHaveBeenCalledExactlyOnceWith(undefined);
  await other.release();
  await first.release();
  await (await secondPromise).release();
});

it("compensates only this run after partial provisioning and surfaces other errors immediately", async () => {
  const first = await acquire("one");
  const error = new Error("Auth unavailable");
  mocks.create.mockRejectedValueOnce(error);
  mocks.marker.mockResolvedValueOnce("two");
  await expect(acquire("two")).rejects.toBe(error);
  expect(mocks.marker).toHaveBeenCalledWith("two");
  expect(mocks.remove).toHaveBeenCalledExactlyOnceWith(app, "two");
  await first.release();
});

it.each([
  null,
  new Error("branches limit exceeded"),
  { response: { status: 401 } },
  { response: { status: 429 } },
  { response: { status: 422, data: { message: "storage limit exceeded" } } },
])("does not confuse unrelated errors with branch capacity: %j", (error) => {
  expect(isNeonBranchCapacityError(error)).toBe(false);
});
