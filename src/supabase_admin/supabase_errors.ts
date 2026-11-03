import { DyadError, DyadErrorKind } from "@/errors/dyad_error";

/** Fixed status-specific guidance, separate from untrusted OAuth response text. */
export class SupabaseTokenRefreshError extends DyadError {
  readonly userMessage: string;

  constructor(status: number) {
    const authRejected = status === 400 || status === 401 || status === 403;
    const guidance = authRejected
      ? "Go to Settings to disconnect Supabase and then reconnect."
      : status === 429
        ? "Supabase is receiving too many requests. Wait a moment, then try again."
        : "Supabase couldn't refresh your connection. Try again in a moment.";
    super(
      `Supabase token refresh failed (HTTP ${status}). ${guidance}`,
      authRejected
        ? DyadErrorKind.Auth
        : status === 429
          ? DyadErrorKind.RateLimited
          : DyadErrorKind.External,
    );
    this.userMessage = `Supabase token refresh failed. ${guidance}`;
  }
}
