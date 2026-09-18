// Safe to import from both processes: no Electron, no Node.

export const GITLAB_COM_URL = "https://gitlab.com";

/**
 * The canonical form of a GitLab instance address: scheme, host, port and any
 * path prefix, no trailing slash, no query, no fragment.
 *
 * Stored on every app the connection links, and compared against the current
 * connection before a push — so two spellings of one instance must collapse
 * to the same string.
 */
export function normalizeGitLabInstanceUrl(value: string): string {
  const url = new URL(value.trim());
  url.hash = "";
  url.search = "";
  const pathname = url.pathname.replace(/\/+$/, "");
  return `${url.origin}${pathname}`;
}

/** Whether a string parses as an http(s) address at all. */
export function isGitLabInstanceUrl(value: string): boolean {
  try {
    const protocol = new URL(value.trim()).protocol;
    return protocol === "https:" || protocol === "http:";
  } catch {
    return false;
  }
}

/** The host a user recognises an instance by, for messages and labels. */
export function gitLabInstanceLabel(instanceUrl: string): string {
  try {
    const url = new URL(instanceUrl);
    const pathname = url.pathname.replace(/\/+$/, "");
    return `${url.host}${pathname}`;
  } catch {
    return instanceUrl;
  }
}
