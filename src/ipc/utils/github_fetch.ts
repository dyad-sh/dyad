/**
 * Keep GitHub on Node's built-in (Undici) transport. node-fetch 2's stream
 * close heuristic rejected complete gzip/chunked device responses on Electron
 * 43 (#3837). This also avoids Chromium session cookies and readiness rules.
 */
export default function fetchGitHub(
  url: string,
  init?: RequestInit,
): Promise<Response> {
  return globalThis.fetch(url, {
    ...init,
    credentials: "omit",
    cache: "no-store",
  });
}
