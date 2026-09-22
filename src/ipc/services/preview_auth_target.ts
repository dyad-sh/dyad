import type { NeonPreviewTarget } from "./neon_preview_domain_service";
import type { SupabasePreviewTarget } from "./supabase_preview_redirect_service";

/** Captured under provider admission; background registration never rereads it. */
export type PreviewAuthTarget =
  | ({ provider: "neon" } & NeonPreviewTarget)
  | ({ provider: "supabase" } & SupabasePreviewTarget);

export function samePreviewAuthTarget(
  left: PreviewAuthTarget | null | undefined,
  right: PreviewAuthTarget,
): boolean {
  if (!left || left.projectId !== right.projectId) return false;
  if (left.provider === "neon" && right.provider === "neon")
    return left.branchId === right.branchId;
  if (left.provider === "supabase" && right.provider === "supabase")
    return left.organizationSlug === right.organizationSlug;
  return false;
}
