/**
 * Whether an attachment is unpacked as a zip archive. Shared by the main
 * process, which decides what to extract, and the chat UI, which shows
 * archives differently, so both agree on which files count.
 */
export function isZipAttachmentName(name: string): boolean {
  return name.trim().toLowerCase().endsWith(".zip");
}
