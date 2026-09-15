import { escapeXmlAttr } from "./xmlEscape";

export function buildDyadAttachmentTag(attachment: {
  name: string;
  type: string;
  url: string;
  path: string;
  attachmentType: string;
}): string {
  return `\n<dyad-attachment name="${escapeXmlAttr(attachment.name)}" type="${escapeXmlAttr(attachment.type)}" url="${escapeXmlAttr(attachment.url)}" path="${escapeXmlAttr(attachment.path)}" attachment-type="${escapeXmlAttr(attachment.attachmentType)}"></dyad-attachment>\n`;
}
