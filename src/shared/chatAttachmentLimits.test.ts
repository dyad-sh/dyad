import { describe, expect, it } from "vitest";

import {
  inspectBase64DataUrl,
  MAX_CHAT_ATTACHMENT_BYTES,
  MAX_CHAT_ATTACHMENTS,
  MAX_CHAT_ATTACHMENTS_TOTAL_BYTES,
  validateChatAttachmentFiles,
  validateSerializedChatAttachments,
} from "./chatAttachmentLimits";

function dataUrlForDecodedBytes(bytes: number): string {
  const padding = bytes === 0 ? 0 : (3 - (bytes % 3)) % 3;
  const encodedLength = 4 * Math.ceil(bytes / 3);
  return `data:application/octet-stream;base64,${"A".repeat(encodedLength - padding)}${"=".repeat(padding)}`;
}

describe("chat attachment file limits", () => {
  it("accepts the count, per-file, and aggregate boundaries", () => {
    expect(
      validateChatAttachmentFiles(
        Array.from({ length: MAX_CHAT_ATTACHMENTS }, (_, index) => ({
          name: `${index}.txt`,
          size: 0,
        })),
      ),
    ).toEqual({ ok: true, totalBytes: 0 });

    expect(
      validateChatAttachmentFiles([
        { name: "first.bin", size: MAX_CHAT_ATTACHMENT_BYTES },
        { name: "second.bin", size: MAX_CHAT_ATTACHMENT_BYTES },
        {
          name: "third.bin",
          size:
            MAX_CHAT_ATTACHMENTS_TOTAL_BYTES - 2 * MAX_CHAT_ATTACHMENT_BYTES,
        },
      ]),
    ).toEqual({
      ok: true,
      totalBytes: MAX_CHAT_ATTACHMENTS_TOTAL_BYTES,
    });
  });

  it("rejects too many files", () => {
    const result = validateChatAttachmentFiles(
      Array.from({ length: MAX_CHAT_ATTACHMENTS + 1 }, (_, index) => ({
        name: `${index}.txt`,
        size: 0,
      })),
    );
    expect(result).toMatchObject({ ok: false, code: "too-many-files" });
  });

  it("rejects a file over the per-file limit", () => {
    const result = validateChatAttachmentFiles([
      { name: "large.bin", size: MAX_CHAT_ATTACHMENT_BYTES + 1 },
    ]);
    expect(result).toMatchObject({ ok: false, code: "file-too-large" });
  });

  it("rejects attachments over the aggregate limit", () => {
    const result = validateChatAttachmentFiles([
      { name: "first.bin", size: MAX_CHAT_ATTACHMENT_BYTES },
      { name: "second.bin", size: MAX_CHAT_ATTACHMENT_BYTES },
      {
        name: "third.bin",
        size:
          MAX_CHAT_ATTACHMENTS_TOTAL_BYTES - 2 * MAX_CHAT_ATTACHMENT_BYTES + 1,
      },
    ]);
    expect(result).toMatchObject({ ok: false, code: "total-too-large" });
  });
});

describe("serialized chat attachment limits", () => {
  it("calculates decoded bytes without decoding the payload", () => {
    expect(inspectBase64DataUrl("data:text/plain;base64,SGVsbG8=")).toEqual({
      ok: true,
      decodedBytes: 5,
      payloadStart: 23,
    });
  });

  it.each([
    "SGVsbG8=",
    "http:text/plain;base64,SGVsbG8=",
    "data:text/plain,SGVsbG8=",
    "data:text/plain;base64,SGVsbG8",
    "data:text/plain;base64,SGVsbG8*",
    "data:text/plain;base64,SG=VsbG8",
  ])("rejects a malformed base64 data URL: %s", (data) => {
    const result = validateSerializedChatAttachments([
      { name: "bad.txt", data },
    ]);
    expect(result).toMatchObject({ ok: false, code: "invalid-data-url" });
  });

  it("accepts an attachment exactly at the decoded per-file boundary", () => {
    const result = validateSerializedChatAttachments([
      {
        name: "boundary.bin",
        data: dataUrlForDecodedBytes(MAX_CHAT_ATTACHMENT_BYTES),
      },
    ]);
    expect(result).toEqual({
      ok: true,
      totalBytes: MAX_CHAT_ATTACHMENT_BYTES,
    });
  });

  it("rejects based on decoded size, including equal-length padded payloads", () => {
    const result = validateSerializedChatAttachments([
      {
        name: "too-large.bin",
        data: dataUrlForDecodedBytes(MAX_CHAT_ATTACHMENT_BYTES + 1),
      },
    ]);
    expect(result).toMatchObject({ ok: false, code: "file-too-large" });
  });

  it("accepts attachments exactly at the aggregate decoded-byte boundary", () => {
    const tenMiB = dataUrlForDecodedBytes(MAX_CHAT_ATTACHMENT_BYTES);
    const remaining = dataUrlForDecodedBytes(
      MAX_CHAT_ATTACHMENTS_TOTAL_BYTES - 2 * MAX_CHAT_ATTACHMENT_BYTES,
    );
    const result = validateSerializedChatAttachments([
      { name: "first.bin", data: tenMiB },
      { name: "second.bin", data: tenMiB },
      { name: "third.bin", data: remaining },
    ]);
    expect(result).toEqual({
      ok: true,
      totalBytes: MAX_CHAT_ATTACHMENTS_TOTAL_BYTES,
    });
  });

  it("enforces the aggregate decoded-byte limit", () => {
    const tenMiB = dataUrlForDecodedBytes(MAX_CHAT_ATTACHMENT_BYTES);
    const remainingPlusOne = dataUrlForDecodedBytes(
      MAX_CHAT_ATTACHMENTS_TOTAL_BYTES - 2 * MAX_CHAT_ATTACHMENT_BYTES + 1,
    );
    const result = validateSerializedChatAttachments([
      { name: "first.bin", data: tenMiB },
      { name: "second.bin", data: tenMiB },
      { name: "third.bin", data: remainingPlusOne },
    ]);
    expect(result).toMatchObject({ ok: false, code: "total-too-large" });
  });
});
