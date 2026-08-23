import { safeGithubOpsErrorMessage } from "./github_ops_safe_error";

/**
 * Build output and upstream API messages are untrusted renderer/telemetry
 * input. Reuse the bounded main-process projection that redacts credentials,
 * local paths, private remotes, identities, URLs, and internal hosts.
 */
export function safeTempPreviewErrorMessage(
  error: unknown,
  fallback = "Temporary preview failed.",
): string {
  return safeGithubOpsErrorMessage(error, fallback);
}
