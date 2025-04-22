import { readSettings } from "../../main/settings";
import { SupabaseManagementAPI } from "supabase-management-js";

// Function to get the Supabase Management API client
export async function getSupabaseClient(): Promise<SupabaseManagementAPI> {
  const settings = readSettings();
  // Check if Supabase token exists in settings
  const supabaseAccessToken = settings.supabase?.accessToken?.value;

  if (!supabaseAccessToken) {
    throw new Error(
      "Supabase access token not found. Please authenticate first."
    );
  }

  return new SupabaseManagementAPI({
    accessToken: supabaseAccessToken,
  });
}

export async function getSupabaseProjectName(
  projectId: string
): Promise<string> {
  const supabase = await getSupabaseClient();
  const projects = await supabase.getProjects();
  const project = projects?.find((p) => p.id === projectId);
  return project?.name || `<project not found for: ${projectId}>`;
}
