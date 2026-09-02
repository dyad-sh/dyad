import log from "electron-log";
import fetch from "node-fetch";
import { createTypedHandler } from "./base";
import { systemContracts } from "../types/system";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { IS_TEST_BUILD } from "@/ipc/utils/test_utils";

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

/** In-flight uploads, so a report that is abandoned can stop sending. */
const uploads = new Map<string, AbortController>();

export function registerUploadHandlers() {
  createTypedHandler(systemContracts.uploadToSignedUrl, async (_, params) => {
    const { url, contentType, data, uploadId } = params;
    logger.debug("IPC: upload-to-signed-url called");

    // Validate the signed URL. E2E builds also accept a loopback address so a
    // test can stand in for the upload service.
    const isSignedUrl =
      typeof url === "string" &&
      (url.startsWith("https://") || (IS_TEST_BUILD && isTestUploadUrl(url)));
    if (!isSignedUrl) {
      throw new DyadError(
        "Invalid signed URL provided",
        DyadErrorKind.Validation,
      );
    }

    // Validate content type
    if (!contentType || typeof contentType !== "string") {
      throw new DyadError(
        "Invalid content type provided",
        DyadErrorKind.Validation,
      );
    }

    // Perform the upload to the signed URL. Aborting destroys the socket, which
    // stops a large body mid-stream but cannot recall bytes the kernel already
    // sent -- a small body is on its way out before anyone can press anything.
    const controller = new AbortController();
    if (uploadId) uploads.set(uploadId, controller);
    let response;
    try {
      response = await fetch(url, {
        method: "PUT",
        headers: {
          "Content-Type": contentType,
        },
        body: JSON.stringify(data),
        signal: controller.signal,
      });
    } finally {
      if (uploadId) uploads.delete(uploadId);
    }

    if (!response.ok) {
      throw new Error(
        `Upload failed with status ${response.status}: ${response.statusText}`,
      );
    }

    logger.debug("Successfully uploaded data to signed URL");
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
