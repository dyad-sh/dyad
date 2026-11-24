import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { canDeploySupabaseFunctions } from "./supabase_self_hosted_store";
import { isSupabaseFunctionSyncDeferred } from "./supabase_recording_deferred_sync";

/** Whether Dyad can deploy edge functions to this Supabase project. */
export function supportsSupabaseFunctionDeploys(
  supabaseProjectId: string,
): boolean {
  return canDeploySupabaseFunctions(supabaseProjectId);
}

/**
 * Thrown instead of deploying, deleting or listing edge functions on a project
 * Dyad cannot deploy to. The function code stays in the app; nothing failed.
 */
export class SupabaseFunctionsUnsupportedError extends DyadError {
  constructor() {
    super(
      "Edge functions aren't deployed to this self-hosted Supabase instance because it was added without SSH access. The function code is saved in supabase/functions.",
      DyadErrorKind.Precondition,
    );
    this.name = "SupabaseFunctionsUnsupportedError";
  }
}

export function assertSupabaseFunctionDeploysSupported(
  supabaseProjectId: string,
): void {
  if (!supportsSupabaseFunctionDeploys(supabaseProjectId)) {
    throw new SupabaseFunctionsUnsupportedError();
  }
}

/**
 * A function sync that did not run but did not fail either: deferred until a
 * recording ends, or not supported for this project. Callers report its
 * message as a successful outcome.
 */
export function isSupabaseFunctionSyncSkipped(
  error: unknown,
): error is DyadError {
  return (
    isSupabaseFunctionSyncDeferred(error) ||
    error instanceof SupabaseFunctionsUnsupportedError
  );
}
