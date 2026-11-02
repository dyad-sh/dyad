import { DyadError, DyadErrorKind } from "@/errors/dyad_error";

/** Fixed reconnect guidance, separate from untrusted OAuth response text. */
export class SupabaseTokenRefreshError extends DyadError {
  readonly userMessage =
    "Supabase token refresh failed. Go to Settings to disconnect Supabase and then reconnect.";

  constructor(status: number) {
    super(
      `Supabase token refresh failed (HTTP ${status}). Go to Settings to disconnect Supabase and then reconnect.`,
      DyadErrorKind.External,
    );
  }
}
