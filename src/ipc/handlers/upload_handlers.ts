import log from "electron-log";
import fetch from "node-fetch";
import { createTypedHandler } from "./base";
import { systemContracts } from "../types/system";
import { sessionUploadContracts } from "../types/session_upload";

const logger = log.scope("upload_handlers");

export function registerUploadHandlers() {
  createTypedHandler(systemContracts.uploadToSignedUrl, async (_, params) => {
    const { url, contentType, data } = params;
    logger.debug("IPC: upload-to-signed-url called");

    // Validate the signed URL
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      throw new Error("Invalid signed URL provided");
    }
    if (parsedUrl.protocol !== "https:") {
      throw new Error("Invalid signed URL provided");
    }

    // Validate content type
    if (!contentType || typeof contentType !== "string") {
      throw new Error("Invalid content type provided");
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

  /**
   * Upload session data to a signed URL.
   * This is the main handler for uploading chat session data including
   * AI calls, tool calls, timing information, and error tracking.
   *
   * @example
   * ```typescript
   * await ipc.sessionUpload.uploadSession({
   *   url: "https://storage.example.com/session-abc123?signature=...",
   *   payload: {
   *     schemaVersion: "1.0.0",
   *     sessionId: "session_abc123",
   *     uploadedAt: new Date().toISOString(),
   *     client: { ... },
   *     settings: { ... },
   *     app: { ... },
   *     chat: { ... },
   *     messages: [ ... ],
   *     summary: { ... },
   *   },
   * });
   * ```
   */
  createTypedHandler(
    sessionUploadContracts.uploadSession,
    async (_, params) => {
      const { url, payload } = params;
      logger.debug("IPC: session:upload called", {
        sessionId: payload.sessionId,
        messageCount: payload.messages.length,
      });

      // Validate the signed URL
      let parsedUrl: URL;
      try {
        parsedUrl = new URL(url);
      } catch {
        throw new Error("Invalid signed URL provided");
      }
      if (parsedUrl.protocol !== "https:") {
        throw new Error("Invalid signed URL provided");
      }

      // Log session summary for debugging
      logger.info("Uploading session data:", {
        sessionId: payload.sessionId,
        schemaVersion: payload.schemaVersion,
        chatId: payload.chat.id,
        appId: payload.app.id,
        summary: payload.summary,
      });

      // Perform the upload to the signed URL
      const response = await fetch(url, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error(
          `Session upload failed with status ${response.status}: ${response.statusText}`,
        );
      }

      logger.debug("Successfully uploaded session data", {
        sessionId: payload.sessionId,
      });
    },
  );

  logger.debug("Registered upload IPC handlers");
}
