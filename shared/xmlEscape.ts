/**
 * XML escape/unescape utilities for dyad tags.
 *
 * When serializing dyad tags, we escape special characters to prevent
 * breaking the tag structure. When deserializing (parsing), we need
 * to unescape these characters to get the original values.
 */

/**
 * Escapes special characters in XML attribute values.
 * Handles: & " < >
 */
export function escapeXmlAttr(str: string | null | undefined): string {
  if (str == null) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Unescapes XML attribute values.
 * Note: Order matters - &amp; must be unescaped last to avoid double-unescaping.
 */
export function unescapeXmlAttr(str: string): string {
  return str
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&");
}

/**
 * Escapes special characters in XML content (text between tags).
 * Handles: & < >
 */
export function escapeXmlContent(str: string | null | undefined): string {
  if (str == null) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Unescapes XML content values.
 * Note: Order matters - &amp; must be unescaped last to avoid double-unescaping.
 */
export function unescapeXmlContent(str: string): string {
  return str.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}
