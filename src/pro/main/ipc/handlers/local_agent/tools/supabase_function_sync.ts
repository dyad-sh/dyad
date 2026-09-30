import { isRecordingActive } from "@/ipc/services/recording_registry";
import type { AgentContext } from "./types";

/**
 * Immediate function deploys/deletes are refused while a recording holds the
 * app's `supabase-functions` claim. Queue the function for root finalization
 * instead of dropping the side effect; the finalizer reconciles deploy versus
 * delete from the final tree and reports an error if the recording is still
 * active then.
 *
 * Call this after an immediate deploy/delete fails. Returns true when the
 * failure was a recording refusal and the function was queued.
 */
export function deferFunctionSyncIfRecording(
  ctx: Pick<
    AgentContext,
    "appId" | "pendingFunctionDeploys" | "pendingFunctionDeletes"
  >,
  functionName: string,
  kind: "deploy" | "delete",
): boolean {
  if (!isRecordingActive(ctx.appId)) return false;
  if (kind === "deploy") {
    if (!ctx.pendingFunctionDeploys.includes(functionName)) {
      ctx.pendingFunctionDeploys.push(functionName);
    }
  } else {
    ctx.pendingFunctionDeletes ??= [];
    if (!ctx.pendingFunctionDeletes.includes(functionName)) {
      ctx.pendingFunctionDeletes.push(functionName);
    }
  }
  return true;
}

export const RECORDING_DEFERRED_FUNCTION_SYNC_NOTE =
  "A recording session is active, so the Supabase function deploy was queued for the end of this turn.";
