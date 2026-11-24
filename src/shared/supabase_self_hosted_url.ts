/** URL checks shared by the self-hosted Supabase form and the main process. */

export function isLoopbackHostname(hostname: string): boolean {
  // "localhost." is the same name written fully qualified.
  const name = hostname.replace(/\.$/, "");
  return (
    name === "localhost" ||
    name === "127.0.0.1" ||
    name === "[::1]" ||
    name.endsWith(".localhost")
  );
}

/**
 * Whether Dyad would send the instance's keys unencrypted to another machine.
 * False for a URL that doesn't parse, which the form reports separately.
 */
export function sendsKeysUnencrypted(url: string): boolean {
  try {
    const parsed = new URL(url.trim());
    return parsed.protocol === "http:" && !isLoopbackHostname(parsed.hostname);
  } catch {
    return false;
  }
}
