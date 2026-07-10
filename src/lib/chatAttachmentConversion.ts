import type { ChatAttachment, FileAttachment } from "../ipc/types/chat";

export type ReadFileAsDataUrl = (file: File) => Promise<string>;

export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () =>
      reject(reader.error ?? new Error(`Could not read "${file.name}".`));
    reader.readAsDataURL(file);
  });
}

/**
 * Read attachments one at a time. Reading all files with Promise.all makes the
 * browser retain every FileReader buffer at once in addition to the resulting
 * base64 strings and the subsequent IPC structured clone.
 */
export async function convertFileAttachmentsToChatAttachments(
  attachments: readonly FileAttachment[],
  readFile: ReadFileAsDataUrl = readFileAsDataUrl,
): Promise<ChatAttachment[]> {
  const converted: ChatAttachment[] = [];
  for (const attachment of attachments) {
    converted.push({
      name: attachment.file.name,
      type: attachment.file.type,
      data: await readFile(attachment.file),
      attachmentType: attachment.type,
    });
  }
  return converted;
}
