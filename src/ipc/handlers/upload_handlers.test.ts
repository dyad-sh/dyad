import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.hoisted(() => vi.fn());
vi.mock("node-fetch", () => ({ default: fetchMock }));
vi.mock("electron-log", () => ({
  default: { scope: () => ({ debug: vi.fn(), warn: vi.fn(), error: vi.fn() }) },
}));

import { getRegisteredHandlerForTesting } from "./base";
import { registerUploadHandlers } from "./upload_handlers";
import { systemContracts } from "../types/system";
import { getCapture, retainCapture } from "@/ipc/utils/screenshot_captures";

registerUploadHandlers();

const upload = getRegisteredHandlerForTesting(
  systemContracts.uploadToSignedUrl.channel,
);
const uploadScreenshot = getRegisteredHandlerForTesting(
  systemContracts.uploadScreenshot.channel,
);
const cancel = getRegisteredHandlerForTesting(
  systemContracts.cancelUpload.channel,
);
const event = {} as never;

/** Stands in for a NativeImage: the handler only ever asks it for PNG bytes. */
function fakeCapture(bytes = 16) {
  return {
    toPNG: () => Buffer.alloc(bytes, 1),
  } as unknown as Electron.NativeImage;
}

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
    // every reporter who backs out would look like a broken uploader. It is
    // still not a finished upload, and the caller has to be able to tell.
    await expect(running).resolves.toEqual({ uploaded: false });
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
    await expect(running).resolves.toEqual({ uploaded: true });
  });

  it("still throws when storage rejects a session upload", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 403,
      statusText: "Forbidden",
    });

    await expect(
      upload(event, { ...params, uploadId: freshId() }),
    ).rejects.toThrow("Upload failed with status 403: Forbidden");
  });

  it("says so when there is nothing left to cancel", async () => {
    expect(await cancel(event, { uploadId: "gone" })).toEqual({
      cancelled: false,
    });
  });

  it("stops tracking an upload once it finishes", async () => {
    const id = freshId();
    fetchMock.mockResolvedValue({ ok: true, status: 200, statusText: "OK" });
    expect(await upload(event, { ...params, uploadId: id })).toEqual({
      uploaded: true,
    });

    // A finished upload must not leave an entry behind for the map to grow on.
    expect(await cancel(event, { uploadId: id })).toEqual({
      cancelled: false,
    });
  });
});

describe("screenshot upload", () => {
  let nextId = 0;
  const freshId = () => `shot-${++nextId}`;
  const signed = {
    url: "https://storage.test/bucket/abc.png?signature",
    headers: {
      "Content-Type": "image/png",
      "x-goog-custom-time": "2026-09-23T22:33:26.077Z",
      "x-goog-content-length-range": "0,1024",
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock.mockResolvedValue({ ok: true, status: 200, statusText: "OK" });
  });

  it("PUTs the PNG bytes with the headers the signature covers", async () => {
    const captureId = freshId();
    retainCapture(captureId, fakeCapture(16));

    const result = await uploadScreenshot(event, {
      ...signed,
      captureId,
      uploadId: freshId(),
    });

    expect(result).toEqual({ uploaded: true });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(signed.url);
    expect(init.method).toBe("PUT");
    expect(init.headers).toEqual(signed.headers);
    expect(Buffer.isBuffer(init.body)).toBe(true);
    expect(init.body.length).toBe(16);
  });

  it("forwards only headers a signed URL can bind", async () => {
    const captureId = freshId();
    retainCapture(captureId, fakeCapture());

    await uploadScreenshot(event, {
      ...signed,
      headers: {
        ...signed.headers,
        Authorization: "Bearer stolen",
        Cookie: "session=1",
      },
      captureId,
      uploadId: freshId(),
    });

    // The renderer names the headers, so main must not become a way to
    // attach arbitrary ones to a request it makes with its own network
    // identity.
    expect(fetchMock.mock.calls[0][1].headers).toEqual(signed.headers);
  });

  it("forgets the capture once it is in the bucket", async () => {
    const captureId = freshId();
    retainCapture(captureId, fakeCapture());

    await uploadScreenshot(event, {
      ...signed,
      captureId,
      uploadId: freshId(),
    });

    // Nothing will paste it now, and it is a full picture of the window.
    expect(getCapture(captureId)).toBeUndefined();
  });

  it("keeps the capture when the upload fails, for the clipboard fallback", async () => {
    const captureId = freshId();
    retainCapture(captureId, fakeCapture());
    fetchMock.mockResolvedValue({
      ok: false,
      status: 403,
      statusText: "Forbidden",
    });

    // Reported as a result, not thrown: the caller falls back on it, and a
    // thrown error would be logged as an app fault.
    expect(
      await uploadScreenshot(event, {
        ...signed,
        captureId,
        uploadId: freshId(),
      }),
    ).toEqual({
      uploaded: false,
      reason: "rejected",
      detail: "Upload failed with status 403: Forbidden",
    });
    expect(getCapture(captureId)).toBeDefined();
  });

  it("reports a capture main no longer holds, without sending anything", async () => {
    expect(
      await uploadScreenshot(event, {
        ...signed,
        captureId: "never-taken",
        uploadId: freshId(),
      }),
    ).toEqual({ uploaded: false, reason: "missing" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses to send an image over the size the URL was signed for", async () => {
    const captureId = freshId();
    retainCapture(captureId, fakeCapture(2048));

    expect(
      await uploadScreenshot(event, {
        ...signed,
        captureId,
        uploadId: freshId(),
      }),
    ).toEqual({ uploaded: false, reason: "too-large" });
    // The service would reject it anyway; this just spares the bytes. The
    // capture stays, so the reporter can still paste it.
    expect(fetchMock).not.toHaveBeenCalled();
    expect(getCapture(captureId)).toBeDefined();
  });

  it("checks the size bound whatever the header's capitalisation", async () => {
    const captureId = freshId();
    retainCapture(captureId, fakeCapture(2048));

    expect(
      await uploadScreenshot(event, {
        url: signed.url,
        headers: {
          "Content-Type": "image/png",
          "X-Goog-Custom-Time": "2026-09-23T22:33:26.077Z",
          "X-Goog-Content-Length-Range": "0,1024",
        },
        captureId,
        uploadId: freshId(),
      }),
    ).toEqual({ uploaded: false, reason: "too-large" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("gives up on a PUT that outlives the signed URL, keeping the capture", async () => {
    vi.useFakeTimers();
    try {
      const captureId = freshId();
      retainCapture(captureId, fakeCapture());
      const { inFlight, getSignal } = pendingFetch();

      const running = uploadScreenshot(event, {
        ...signed,
        captureId,
        uploadId: freshId(),
      });
      await inFlight;
      await vi.advanceTimersByTimeAsync(2 * 60 * 1000);

      // A failure, not a cancel: the renderer falls back to the clipboard
      // rather than treating a stalled transfer as the reporter's choice.
      expect(await running).toEqual({
        uploaded: false,
        reason: "timeout",
        detail: "Upload timed out after 120s",
      });
      expect(getSignal()?.aborted).toBe(true);
      expect(getCapture(captureId)).toBeDefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("a cancel before the timeout is still reported as a cancel", async () => {
    vi.useFakeTimers();
    try {
      const captureId = freshId();
      const uploadId = freshId();
      retainCapture(captureId, fakeCapture());
      const { inFlight } = pendingFetch();

      const running = uploadScreenshot(event, {
        ...signed,
        captureId,
        uploadId,
      });
      await inFlight;
      await vi.advanceTimersByTimeAsync(30 * 1000);
      await cancel(event, { uploadId });

      await expect(running).resolves.toEqual({
        uploaded: false,
        reason: "cancelled",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("reports a dropped connection as a result too", async () => {
    const captureId = freshId();
    retainCapture(captureId, fakeCapture());
    fetchMock.mockRejectedValue(new Error("socket hang up"));

    expect(
      await uploadScreenshot(event, {
        ...signed,
        captureId,
        uploadId: freshId(),
      }),
    ).toEqual({ uploaded: false, reason: "network", detail: "socket hang up" });
    expect(getCapture(captureId)).toBeDefined();
  });

  it("can be cancelled like a session upload", async () => {
    const captureId = freshId();
    const uploadId = freshId();
    retainCapture(captureId, fakeCapture());
    const { inFlight, getSignal } = pendingFetch();

    const running = uploadScreenshot(event, {
      ...signed,
      captureId,
      uploadId,
    });
    await inFlight;
    expect(await cancel(event, { uploadId })).toEqual({ cancelled: true });
    expect(getSignal()?.aborted).toBe(true);

    await expect(running).resolves.toEqual({
      uploaded: false,
      reason: "cancelled",
    });
    // A cancelled upload is not a fault, and the image is still the
    // report's to fall back on.
    expect(getCapture(captureId)).toBeDefined();
  });

  it("refuses anything but a signed https URL", async () => {
    const captureId = freshId();
    retainCapture(captureId, fakeCapture());

    await expect(
      uploadScreenshot(event, {
        ...signed,
        url: "http://storage.test/bucket/abc.png",
        captureId,
        uploadId: freshId(),
      }),
    ).rejects.toThrow("Invalid signed URL");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
