import type { ChatAttachment, FileAttachment } from "@/ipc/types";

/**
 * Convert a renderer-side FileAttachment (holding a browser File object) into a
 * serializable ChatAttachment (base64 data-URL). Used both when sending a chat
 * message over IPC and when persisting queued prompts to disk.
 */
export function fileAttachmentToChatAttachment(
  attachment: FileAttachment,
): Promise<ChatAttachment> {
  return new Promise<ChatAttachment>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      resolve({
        name: attachment.file.name,
        type: attachment.file.type,
        data: reader.result as string,
        attachmentType: attachment.type,
      });
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(attachment.file);
  });
}

/**
 * Reverse of fileAttachmentToChatAttachment: reconstruct a FileAttachment
 * (with a browser File object) from a serialized ChatAttachment. Used when
 * hydrating persisted queued prompts back into the in-memory queue.
 *
 * `data` is a data-URL (`data:<mime>;base64,<payload>`); if it isn't a
 * recognizable data-URL we fall back to treating the whole string as the
 * base64 payload.
 */
export function chatAttachmentToFileAttachment(
  attachment: ChatAttachment,
): FileAttachment {
  const base64 = extractBase64Payload(attachment.data);
  const bytes = base64ToBytes(base64);
  const file = new File([bytes], attachment.name, { type: attachment.type });
  return {
    file,
    type: attachment.attachmentType,
  };
}

/**
 * Decode a base64 payload into bytes. Prefers `Buffer.from` where available
 * (Node.js / Vitest / Electron renderer with node integration), which decodes
 * in native code instead of the slow char-by-char `atob` loop that can block
 * the UI thread for large attachments. Falls back to `atob` in pure browser
 * contexts where `Buffer` is undefined.
 */
function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  if (typeof Buffer !== "undefined") {
    // `new Uint8Array(buffer)` copies the natively-decoded bytes into a plain
    // ArrayBuffer-backed view (Buffer's type is the wider ArrayBufferLike).
    return new Uint8Array(Buffer.from(base64, "base64"));
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function extractBase64Payload(data: string): string {
  const commaIndex = data.indexOf(",");
  if (data.startsWith("data:") && commaIndex !== -1) {
    return data.slice(commaIndex + 1);
  }
  return data;
}
