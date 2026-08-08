import { ipc, type FileAttachment } from "@/ipc/types";
import type { ChatAgentAttachmentInfo } from "@/components/chat-agent/types";

/** Attachment metadata to keep on the sent message, for its file cards. */
export function describeAttachments(
  attachments: FileAttachment[],
): ChatAgentAttachmentInfo[] | undefined {
  if (attachments.length === 0) return undefined;
  return attachments.map(({ file }) => ({
    name: file.name,
    mimeType: file.type,
    sizeBytes: file.size,
  }));
}

const TEXT_TYPES = new Set([
  "text/plain",
  "text/markdown",
  "text/csv",
  "application/json",
  "text/javascript",
  "application/javascript",
  "text/html",
  "text/css",
]);

const TEXT_EXTENSIONS = /\.(txt|md|json|csv|js|ts|tsx|jsx|html|css|yaml|yml)$/i;

/**
 * Main-process OCR has its own two-minute network timeout. Keep a slightly
 * wider renderer deadline as a final safety net in case the IPC handler gets
 * stuck doing follow-up work or the renderer never receives its reply.
 */
export const DOCUMENT_READING_TIMEOUT_MS = 135_000;

/** Documents worth sending through the OCR model. */
export function needsDocumentReading(file: File): boolean {
  return file.type === "application/pdf" || /\.pdf$/i.test(file.name.trim());
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result ?? "");
      resolve(dataUrl.slice(dataUrl.indexOf(",") + 1));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function isTextLikeFile(file: File): boolean {
  if (TEXT_TYPES.has(file.type)) return true;
  if (file.type.startsWith("text/")) return true;
  return TEXT_EXTENSIONS.test(file.name);
}

export type PreparedAttachmentMessage = {
  /** What the model receives: the prompt plus extracted document text. */
  modelText: string;
  /** What the bubble shows: the prompt alone — files render as cards. */
  displayText: string;
  /** Document failures that should be surfaced without blocking the turn. */
  attachmentErrors: string[];
};

async function withDocumentReadingTimeout<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new Error(
                "Document reading took too long and was stopped. Check the OCR model connection and try again.",
              ),
            ),
          DOCUMENT_READING_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Prepares a message with attachments.
 *
 * The extracted text of a document belongs in the model's copy, not on
 * screen: dumping a whole brochure into the user's own bubble buries the
 * question they asked. The file itself is already shown as a card.
 */
export async function prepareChatAgentMessage(
  text: string,
  attachments: FileAttachment[],
): Promise<PreparedAttachmentMessage> {
  const trimmed = text.trim();
  if (attachments.length === 0) {
    return { modelText: trimmed, displayText: trimmed, attachmentErrors: [] };
  }

  const sections: string[] = [];
  const attachmentErrors: string[] = [];
  if (trimmed) sections.push(trimmed);

  for (const { file } of attachments) {
    if (file.type.startsWith("image/")) {
      sections.push(`[Attached image: ${file.name}]`);
      continue;
    }
    if (isTextLikeFile(file)) {
      try {
        const fileText = await file.text();
        sections.push(`--- ${file.name} ---\n${fileText}`);
      } catch {
        sections.push(`[Attached file: ${file.name}]`);
      }
      continue;
    }
    if (needsDocumentReading(file)) {
      // Documents go through the OCR model, so the chat model receives the
      // contents instead of a filename it can only apologise about.
      try {
        const result = await withDocumentReadingTimeout(
          (async () =>
            ipc.ocr.extractDocumentText({
              fileName: file.name,
              mimeType: file.type || "application/pdf",
              dataBase64: await fileToBase64(file),
            }))(),
        );
        sections.push(`--- Contents of ${file.name} ---\n${result.text}`);
      } catch (error) {
        // The reason travels with the message, so both the user and the
        // model see why the document is name-only.
        const reason =
          error instanceof Error ? error.message : "could not be read";
        attachmentErrors.push(`${file.name}: ${reason}`);
        sections.push(`[Attached file: ${file.name} — not read: ${reason}]`);
      }
      continue;
    }
    sections.push(`[Attached file: ${file.name}]`);
  }

  const modelText = sections.filter(Boolean).join("\n\n");
  // A prompt-less upload still needs something in the bubble, so name the
  // files rather than showing an empty message.
  const displayText =
    trimmed ||
    (attachments.length === 1
      ? attachments[0].file.name
      : `${attachments.length} files`);
  return { modelText, displayText, attachmentErrors };
}

/** Back-compat wrapper for callers that only need the model's copy. */
export async function buildChatAgentMessageWithAttachments(
  text: string,
  attachments: FileAttachment[],
): Promise<string> {
  return (await prepareChatAgentMessage(text, attachments)).modelText;
}

export async function getFirstImageAttachmentDataUrl(
  attachments: FileAttachment[],
): Promise<string | undefined> {
  const image = attachments.find(({ file }) => file.type.startsWith("image/"));
  if (!image) return undefined;

  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Could not read attached image."));
    reader.readAsDataURL(image.file);
  });
}
