/**
 * Stand-in for supabase_self_hosted_store in unit tests that never initialize
 * the database. Every project defaults to Supabase Cloud; a test can make one
 * self-hosted by overriding a mock, e.g.
 * `vi.mocked(isSupabaseSelfHostedProject).mockReturnValue(true)`.
 *
 * Use it with `vi.mock("@/supabase_admin/supabase_self_hosted_store", () =>
 * import("@/testing/supabase_self_hosted_store_cloud_only"))`.
 */
import { vi } from "vitest";
import type * as Store from "@/supabase_admin/supabase_self_hosted_store";
import { hasSupabaseCredentialsForOrganization } from "@/lib/schemas";

export const isSupabaseSelfHostedProject = vi.fn<
  typeof Store.isSupabaseSelfHostedProject
>(() => false);

export const getSupabaseSelfHostedInstance = vi.fn<
  typeof Store.getSupabaseSelfHostedInstance
>(() => null);

export const getSupabaseSelfHostedInstanceSummary = vi.fn<
  typeof Store.getSupabaseSelfHostedInstanceSummary
>(() => null);

export const canDeploySupabaseFunctions = vi.fn<
  typeof Store.canDeploySupabaseFunctions
>(() => true);

export const getSupabaseProjectUrl = vi.fn<typeof Store.getSupabaseProjectUrl>(
  (projectId) => `https://${projectId}.supabase.co`,
);

export const hasSupabaseCredentialsForApp = vi.fn<
  typeof Store.hasSupabaseCredentialsForApp
>(
  (settings, app) =>
    isSupabaseSelfHostedProject(app.supabaseProjectId) ||
    hasSupabaseCredentialsForOrganization(
      settings,
      app.supabaseOrganizationSlug,
    ),
);

export const listSupabaseSelfHostedInstances = vi.fn<
  typeof Store.listSupabaseSelfHostedInstances
>(async () => []);

export const listLinkedApps = vi.fn<typeof Store.listLinkedApps>(() => []);

export const insertSupabaseSelfHostedInstance = vi.fn<
  typeof Store.insertSupabaseSelfHostedInstance
>(async () => {
  throw new Error("Not available in Cloud-only tests");
});

export const deleteSupabaseSelfHostedInstance = vi.fn<
  typeof Store.deleteSupabaseSelfHostedInstance
>(async () => {
  throw new Error("Not available in Cloud-only tests");
});
