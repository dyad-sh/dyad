import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.hoisted(() => vi.fn());
vi.mock("node-fetch", () => ({ default: fetchMock }));
vi.mock("electron-log", () => ({
  default: { scope: () => ({ debug: vi.fn(), error: vi.fn() }) },
}));

import { getRegisteredHandlerForTesting } from "./base";
import { registerUploadHandlers } from "./upload_handlers";
import { systemContracts } from "../types/system";

registerUploadHandlers();

const upload = getRegisteredHandlerForTesting(
  systemContracts.uploadToSignedUrl.channel,
);
const cancel = getRegisteredHandlerForTesting(
  systemContracts.cancelUpload.channel,
);
const event = {} as never;

/** Resolves once fetch has been called, so a cancel can land mid-flight. */
function pendingFetch() {
  let signal: AbortSignal | undefined;
  let started: () => void;
  const inFlight = new Promise<void>((resolve) => {
    started = resolve;
  });
  fetchMock.mockImplementation(
    (_url: string, init: { signal: AbortSignal }) => {
      signal = init.signal;
      started();
      return new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => {
          const error = new Error("The user aborted a request.");
          error.name = "AbortError";
          reject(error);
        });
      });
    },
  );
  return { inFlight: inFlight!, getSignal: () => signal };
}

const params = {
  url: "https://upload.test/signed",
  contentType: "application/json",
  data: { chat: "private" },
};

describe("upload handlers", () => {
  let nextId = 0;
  /** The handler module keeps one uploads map, which no mock reset clears. */
  const freshId = () => `upload-${++nextId}`;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("aborts an upload that is still in flight", async () => {
    const id = freshId();
    const { inFlight, getSignal } = pendingFetch();
    const running = upload(event, { ...params, uploadId: id });
    await inFlight;

    expect(await cancel(event, { uploadId: id })).toEqual({
      cancelled: true,
    });
    expect(getSignal()?.aborted).toBe(true);
    await running;
  });

  it("does not report a cancelled upload as a failure", async () => {
    const id = freshId();
    const { inFlight } = pendingFetch();
    const running = upload(event, { ...params, uploadId: id });
    await inFlight;
    await cancel(event, { uploadId: id });

    // Rethrowing would publish an AbortError to the exception telemetry, so
    // every reporter who backs out would look like a broken uploader.
    await expect(running).resolves.toBeUndefined();
  });

  it("still reports a real upload failure", async () => {
    const id = freshId();
    fetchMock.mockRejectedValue(new Error("socket hang up"));

    await expect(upload(event, { ...params, uploadId: id })).rejects.toThrow(
      "socket hang up",
    );
  });

  it("accepts an upload that finishes as the abort lands", async () => {
    const id = freshId();
    let finish: (value: unknown) => void = () => {};
    fetchMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const running = upload(event, { ...params, uploadId: id });
    await Promise.resolve();
    await cancel(event, { uploadId: id });

    // The abort lost the race, so this upload really did happen and must be
    // reported like any other success rather than swallowed as a cancel.
    finish({ ok: true, status: 200, statusText: "OK" });
    await expect(running).resolves.toBeUndefined();
  });

  it("says so when there is nothing left to cancel", async () => {
    expect(await cancel(event, { uploadId: "gone" })).toEqual({
      cancelled: false,
    });
  });

  it("stops tracking an upload once it finishes", async () => {
    const id = freshId();
    fetchMock.mockResolvedValue({ ok: true, status: 200, statusText: "OK" });
    await upload(event, { ...params, uploadId: id });

    // A finished upload must not leave an entry behind for the map to grow on.
    expect(await cancel(event, { uploadId: id })).toEqual({
      cancelled: false,
    });
  });
});
