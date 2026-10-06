import log from "electron-log";
import fetch from "node-fetch";
import { createTypedHandler } from "./base";
import { systemContracts } from "../types/system";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { IS_TEST_BUILD } from "@/ipc/utils/test_utils";
import { discardCapture, getCapture } from "@/ipc/utils/screenshot_captures";

const logger = log.scope("upload_handlers");

/**
 * Whether a URL names the loopback fixture an E2E test stands up in place of
 * the upload service. Parsed rather than matched as a prefix, because
 * "http://127.0.0.1:@evil.test/x" carries the loopback prefix but resolves to
 * evil.test. Same shape as isSecureInstanceUrl.
 */
function isTestUploadUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" && url.hostname === "127.0.0.1";
  } catch {
    return false;
  }
}

/** Signed URLs are https. E2E builds also accept the loopback stand-in. */
function assertSignedUrl(url: unknown): asserts url is string {
  const isSignedUrl =
    typeof url === "string" &&
    (url.startsWith("https://") || (IS_TEST_BUILD && isTestUploadUrl(url)));
  if (!isSignedUrl) {
    throw new DyadError(
      "Invalid signed URL provided",
      DyadErrorKind.Validation,
    );
  }
}

/**
 * Headers a signed URL may bind. Anything else the renderer asks main to send
 * is dropped rather than forwarded: this process holds the reporter's
 * cookies and tokens for nothing, but it should not become a way to attach
 * arbitrary headers to a request either.
 */
const SIGNED_HEADER = /^(content-type|x-goog-[a-z0-9-]+)$/i;

/** In-flight uploads, so a report that is abandoned can stop sending. */
const uploads = new Map<string, AbortController>();

/**
 * Bound on the screenshot PUT. Matches the life of the signed URL it goes
 * to: a transfer still running past that is rejected by GCS anyway, so
 * giving up here only turns a certain failure into a prompt one.
 */
const SCREENSHOT_PUT_TIMEOUT_MS = 2 * 60 * 1000;

/**
 * PUTs a body to a signed URL, tracked under `uploadId` so it can be aborted.
 *
 * Aborting destroys the socket, which stops a large body mid-stream but
 * cannot recall bytes the kernel already sent -- a small body is on its way
 * out before anyone can press anything.
 *
 * With `timeoutMs`, a transfer that outlives it is abandoned and reported
 * as a failure, which is distinct from a cancel: the caller falls back
 * rather than treating it as the reporter's choice.
 */
async function putToSignedUrl({
  url,
  headers,
  body,
  uploadId,
  timeoutMs,
}: {
  url: string;
  headers: Record<string, string>;
  body: string | Buffer;
  uploadId: string;
  timeoutMs?: number;
}): Promise<{ uploaded: boolean }> {
  const controller = new AbortController();
  uploads.set(uploadId, controller);
  let timedOut = false;
  const timer =
    timeoutMs === undefined
      ? null
      : setTimeout(() => {
          timedOut = true;
          controller.abort();
        }, timeoutMs);
  let response;
  try {
    response = await fetch(url, {
      method: "PUT",
      headers,
      body,
      signal: controller.signal,
    });
  } catch (error) {
    if (timedOut) {
      throw new Error(`Upload timed out after ${timeoutMs! / 1000}s`);
    }
    // A reporter backing out is an outcome, not a fault. Rethrowing would
    // publish an AbortError to the exception telemetry, so the more often
    // the cancel works the more broken the uploader would look. It is still
    // told apart from a finished upload, which the caller goes on to cite.
    if (controller.signal.aborted) {
      logger.debug("Upload aborted before it finished");
      return { uploaded: false };
    }
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
    uploads.delete(uploadId);
  }

  if (!response.ok) {
    throw new Error(
      `Upload failed with status ${response.status}: ${response.statusText}`,
    );
  }
  return { uploaded: true };
}

/** Upper bound of an `x-goog-content-length-range: min,max` header, if set. */
function maxBytesAllowed(headers: Record<string, string>): number | null {
  // Header names are case-insensitive, and the forwarding filter treats
  // them that way.
  const range = Object.entries(headers).find(
    ([name]) => name.toLowerCase() === "x-goog-content-length-range",
  )?.[1];
  if (!range) return null;
  const max = Number(range.split(",")[1]);
  return Number.isFinite(max) ? max : null;
}

export function registerUploadHandlers() {
  createTypedHandler(systemContracts.uploadToSignedUrl, async (_, params) => {
    const { url, contentType, data, uploadId } = params;
    logger.debug("IPC: upload-to-signed-url called");

    assertSignedUrl(url);

    // Validate content type
    if (!contentType || typeof contentType !== "string") {
      throw new DyadError(
        "Invalid content type provided",
        DyadErrorKind.Validation,
      );
    }

    const result = await putToSignedUrl({
      url,
      headers: { "Content-Type": contentType },
      body: JSON.stringify(data),
      uploadId,
    });
    if (result.uploaded) {
      logger.debug("Successfully uploaded data to signed URL");
    }
    return result;
  });

  createTypedHandler(systemContracts.uploadScreenshot, async (_, params) => {
    const { captureId, url, headers, uploadId } = params;
    logger.debug("IPC: upload-screenshot called");

    assertSignedUrl(url);

    const forwarded: Record<string, string> = {};
    for (const [name, value] of Object.entries(headers)) {
      if (SIGNED_HEADER.test(name)) forwarded[name] = value;
    }

    const image = getCapture(captureId);
    if (!image) return { uploaded: false, reason: "missing" as const };

    // Encoding blocks this process for the whole PNG pass. A capture of a
    // large window takes a noticeable fraction of a second, once per report,
    // which is tolerable; it happens here rather than at capture time so a
    // screenshot the reporter removes costs nothing.
    const png = image.toPNG();
    const max = maxBytesAllowed(forwarded);
    if (max !== null && png.length > max) {
      logger.warn(`Screenshot is ${png.length} bytes, over the ${max} allowed`);
      return { uploaded: false, reason: "too-large" as const };
    }

    const result = await putToSignedUrl({
      url,
      headers: forwarded,
      body: png,
      uploadId,
      timeoutMs: SCREENSHOT_PUT_TIMEOUT_MS,
    });
    if (result.uploaded) {
      // The image is in the bucket now; nothing will paste it. Kept on a
      // failure, so the clipboard fallback still has something to restore.
      discardCapture(captureId);
      logger.debug("Successfully uploaded screenshot to signed URL");
      return { uploaded: true };
    }
    return { uploaded: false, reason: "cancelled" as const };
  });

  createTypedHandler(systemContracts.cancelUpload, async (_, params) => {
    const controller = uploads.get(params.uploadId);
    if (!controller) return { cancelled: false };
    controller.abort();
    uploads.delete(params.uploadId);
    logger.debug("IPC: cancel-upload aborted an in-flight upload");
    return { cancelled: true };
  });

  logger.debug("Registered upload IPC handlers");
}
