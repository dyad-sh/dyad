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

export function registerUploadHandlers() {
  createTypedHandler(systemContracts.uploadToSignedUrl, async (_, params) => {
    const { url, contentType, data } = params;
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

    // Perform the upload to the signed URL
    const response = await fetch(url, {
      method: "PUT",
      headers: {
        "Content-Type": contentType,
      },
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      throw new Error(
        `Upload failed with status ${response.status}: ${response.statusText}`,
      );
    }

    logger.debug("Successfully uploaded data to signed URL");
  });

  logger.debug("Registered upload IPC handlers");
}
