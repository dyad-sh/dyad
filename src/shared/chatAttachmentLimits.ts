const MEBIBYTE = 1024 * 1024;

export const MAX_CHAT_ATTACHMENTS = 10;
export const MAX_CHAT_ATTACHMENT_BYTES = 10 * MEBIBYTE;
export const MAX_CHAT_ATTACHMENTS_TOTAL_BYTES = 25 * MEBIBYTE;

const BASE64_MARKER = ";base64,";
const MAX_DATA_URL_PREFIX_CHARS = 1024;
const MAX_BASE64_PAYLOAD_CHARS = 4 * Math.ceil(MAX_CHAT_ATTACHMENT_BYTES / 3);

/**
 * A cheap upper bound that lets the IPC contract reject oversized strings
 * before walking their base64 payload. Exact decoded sizes are checked below.
 */
export const MAX_CHAT_ATTACHMENT_DATA_URL_CHARS =
  MAX_DATA_URL_PREFIX_CHARS + BASE64_MARKER.length + MAX_BASE64_PAYLOAD_CHARS;

export type ChatAttachmentValidationErrorCode =
  | "too-many-files"
  | "file-too-large"
  | "total-too-large"
  | "invalid-file-size"
  | "invalid-data-url";

export type ChatAttachmentValidationResult =
  | { ok: true; totalBytes: number }
  | {
      ok: false;
      code: ChatAttachmentValidationErrorCode;
      message: string;
    };

export interface ChatAttachmentFileMetadata {
  name: string;
  size: number;
}

export interface SerializedChatAttachmentMetadata {
  name: string;
  data: string;
}

export type Base64DataUrlInspection =
  | { ok: true; decodedBytes: number; payloadStart: number }
  | { ok: false };

function formatBytes(bytes: number): string {
  const mebibytes = bytes / MEBIBYTE;
  return `${Number.isInteger(mebibytes) ? mebibytes : mebibytes.toFixed(1)} MiB`;
}

function displayName(name: string): string {
  return name.trim() || "Unnamed attachment";
}

function isBase64Character(code: number): boolean {
  return (
    (code >= 65 && code <= 90) ||
    (code >= 97 && code <= 122) ||
    (code >= 48 && code <= 57) ||
    code === 43 ||
    code === 47
  );
}

/**
 * Validate a base64 data URL and calculate its decoded byte length without
 * allocating a decoded Buffer. The payload is walked by index so malformed or
 * hostile input does not create another large substring during validation.
 */
export function inspectBase64DataUrl(dataUrl: string): Base64DataUrlInspection {
  if (!dataUrl.startsWith("data:")) {
    return { ok: false };
  }

  const markerIndex = dataUrl.indexOf(BASE64_MARKER);
  if (
    markerIndex < "data:".length ||
    markerIndex > MAX_DATA_URL_PREFIX_CHARS ||
    dataUrl.indexOf(",") !== markerIndex + BASE64_MARKER.length - 1
  ) {
    return { ok: false };
  }

  const payloadStart = markerIndex + BASE64_MARKER.length;
  const encodedLength = dataUrl.length - payloadStart;
  if (encodedLength === 0) {
    return { ok: true, decodedBytes: 0, payloadStart };
  }
  if (encodedLength % 4 !== 0) {
    return { ok: false };
  }

  let padding = 0;
  if (dataUrl.charCodeAt(dataUrl.length - 1) === 61) {
    padding = 1;
    if (dataUrl.charCodeAt(dataUrl.length - 2) === 61) {
      padding = 2;
    }
  }

  const payloadEnd = dataUrl.length - padding;
  for (let index = payloadStart; index < payloadEnd; index += 1) {
    if (!isBase64Character(dataUrl.charCodeAt(index))) {
      return { ok: false };
    }
  }

  for (let index = payloadEnd; index < dataUrl.length; index += 1) {
    if (dataUrl.charCodeAt(index) !== 61) {
      return { ok: false };
    }
  }

  return {
    ok: true,
    decodedBytes: (encodedLength / 4) * 3 - padding,
    payloadStart,
  };
}

export function validateChatAttachmentFiles(
  attachments: readonly ChatAttachmentFileMetadata[],
): ChatAttachmentValidationResult {
  if (attachments.length > MAX_CHAT_ATTACHMENTS) {
    return {
      ok: false,
      code: "too-many-files",
      message: `You can attach up to ${MAX_CHAT_ATTACHMENTS} files at a time.`,
    };
  }

  let totalBytes = 0;
  for (const attachment of attachments) {
    if (!Number.isSafeInteger(attachment.size) || attachment.size < 0) {
      return {
        ok: false,
        code: "invalid-file-size",
        message: `Could not determine the size of "${displayName(attachment.name)}".`,
      };
    }
    if (attachment.size > MAX_CHAT_ATTACHMENT_BYTES) {
      return {
        ok: false,
        code: "file-too-large",
        message: `"${displayName(attachment.name)}" is ${formatBytes(attachment.size)}. Each attachment must be ${formatBytes(MAX_CHAT_ATTACHMENT_BYTES)} or smaller.`,
      };
    }

    totalBytes += attachment.size;
    if (totalBytes > MAX_CHAT_ATTACHMENTS_TOTAL_BYTES) {
      return {
        ok: false,
        code: "total-too-large",
        message: `Attachments total ${formatBytes(totalBytes)}. The combined limit is ${formatBytes(MAX_CHAT_ATTACHMENTS_TOTAL_BYTES)}.`,
      };
    }
  }

  return { ok: true, totalBytes };
}

export function validateSerializedChatAttachments(
  attachments: readonly SerializedChatAttachmentMetadata[],
): ChatAttachmentValidationResult {
  if (attachments.length > MAX_CHAT_ATTACHMENTS) {
    return {
      ok: false,
      code: "too-many-files",
      message: `You can attach up to ${MAX_CHAT_ATTACHMENTS} files at a time.`,
    };
  }

  let totalBytes = 0;
  for (const attachment of attachments) {
    if (attachment.data.length > MAX_CHAT_ATTACHMENT_DATA_URL_CHARS) {
      return {
        ok: false,
        code: "file-too-large",
        message: `"${displayName(attachment.name)}" exceeds the ${formatBytes(MAX_CHAT_ATTACHMENT_BYTES)} attachment limit.`,
      };
    }

    const inspection = inspectBase64DataUrl(attachment.data);
    if (!inspection.ok) {
      return {
        ok: false,
        code: "invalid-data-url",
        message: `"${displayName(attachment.name)}" is not a valid base64 attachment.`,
      };
    }
    if (inspection.decodedBytes > MAX_CHAT_ATTACHMENT_BYTES) {
      return {
        ok: false,
        code: "file-too-large",
        message: `"${displayName(attachment.name)}" is ${formatBytes(inspection.decodedBytes)}. Each attachment must be ${formatBytes(MAX_CHAT_ATTACHMENT_BYTES)} or smaller.`,
      };
    }

    totalBytes += inspection.decodedBytes;
    if (totalBytes > MAX_CHAT_ATTACHMENTS_TOTAL_BYTES) {
      return {
        ok: false,
        code: "total-too-large",
        message: `Attachments total ${formatBytes(totalBytes)}. The combined limit is ${formatBytes(MAX_CHAT_ATTACHMENTS_TOTAL_BYTES)}.`,
      };
    }
  }

  return { ok: true, totalBytes };
}
