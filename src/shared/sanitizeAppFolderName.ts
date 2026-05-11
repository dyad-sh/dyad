// Strip characters that the rename-app handler rejects (`< > : " | ? * / \`
// and ASCII control chars), collapse internal whitespace, and trim. Falls back
// to "untitled-app" if sanitization eats the whole string.
export function sanitizeAppFolderName(name: string): string {
  const sanitized = name
    .replace(/[<>:"|?*/\\]/g, "-")
    // Collapse all whitespace (incl. tabs/newlines) before stripping control
    // chars, so a tab becomes a space rather than disappearing entirely.
    .replace(/\s+/g, " ")
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1f]/g, "")
    .trim()
    .replace(/^-+|-+$/g, "")
    .trim();
  return sanitized || "untitled-app";
}
