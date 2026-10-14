import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { IS_TEST_BUILD } from "@/ipc/utils/test_utils";
import { getProjectApiKeys } from "./supabase_management_client";

export interface AdminKey {
  apiKey: string;
  /** Only legacy service_role JWTs can be used as Bearer tokens. */
  isLegacyJwt: boolean;
}

/** Main-process only. Never expose this key in generated browser code. */
export async function getSupabaseAdminKey({
  projectId,
  organizationSlug,
}: {
  projectId: string;
  organizationSlug: string | null;
}): Promise<AdminKey> {
  if (IS_TEST_BUILD) {
    return { apiKey: "fake-test-admin-key", isLegacyJwt: false };
  }
  const keys = await getProjectApiKeys({
    projectId,
    organizationSlug,
    reveal: true,
  });
  if (!keys?.length) {
    throw new DyadError(
      `No API keys found for Supabase project ${projectId}.`,
      DyadErrorKind.NotFound,
    );
  }
  // Legacy keys remain listed even after being disabled. Prefer a revealed
  // sb_secret_ value, including responses which omit the optional type field.
  const secret =
    keys.find((key) => key.api_key?.startsWith("sb_secret_")) ??
    keys.find((key) => key.type === "secret") ??
    keys.find((key) => key.name === "service_role");
  if (!secret?.api_key) {
    throw new DyadError(
      `No secret key (or legacy service_role key) found for Supabase project ${projectId}. Create a secret key in Supabase under Settings → API Keys.`,
      DyadErrorKind.NotFound,
    );
  }
  return {
    apiKey: secret.api_key,
    isLegacyJwt: !secret.api_key.startsWith("sb_secret_"),
  };
}
