/**
 * Keep GitHub on Node's built-in (Undici) transport. node-fetch 2's stream
 * close heuristic rejected complete gzip/chunked device responses on Electron
 * 43 (#3837). This also avoids Chromium session cookies and readiness rules.
 */
export default async function fetchGitHub(
  url: string,
  init?: RequestInit,
): Promise<Response> {
  try {
    return await globalThis.fetch(url, {
      ...init,
      credentials: "omit",
      cache: "no-store",
    });
  } catch (error) {
    if (
      init?.signal?.aborted ||
      (error instanceof Error &&
        (error.name === "AbortError" || error.name === "TimeoutError"))
    ) {
      throw error;
    }

    // Undici puts DNS/socket/TLS diagnostics in cause; handlers display only
    // message. Prefer the diagnostic code without adding URLs or credentials.
    const cause = error instanceof Error ? error.cause : undefined;
    const code =
      cause && typeof cause === "object" && "code" in cause
        ? cause.code
        : undefined;
    const reason =
      typeof code === "string"
        ? code
        : cause instanceof Error && cause.message
          ? cause.message
          : error instanceof Error
            ? error.message
            : String(error);
    throw new Error(`GitHub request failed: ${reason}`, { cause: error });
  }
}
