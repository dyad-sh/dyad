import { getDyadAppPath } from "@/paths/paths";
import { detectFrameworkType } from "@/ipc/utils/framework_utils";
import { getNeonContext } from "@/neon_admin/neon_context";
import { getPortablePostgresSystemPrompt } from "@/prompts/portable_postgres_prompt";

/**
 * Builds the prompt additions for an app on portable Postgres.
 *
 * The development database is still a Neon branch, so the live schema context
 * is read through the Neon helper. Only the instructions differ: the model is
 * told to write standard Postgres code that also runs against a self-hosted
 * production database.
 */
export async function buildPortablePostgresPromptForApp({
  appPath,
  neonProjectId,
  neonActiveBranchId,
  neonDevelopmentBranchId,
  selectedChatMode,
}: {
  appPath: string;
  neonProjectId: string | null;
  neonActiveBranchId?: string | null;
  neonDevelopmentBranchId?: string | null;
  selectedChatMode: string;
}): Promise<string> {
  const frameworkType = detectFrameworkType(getDyadAppPath(appPath));
  let prompt = getPortablePostgresSystemPrompt(frameworkType);

  const branchId = neonActiveBranchId ?? neonDevelopmentBranchId;
  // The local agent fetches schema on demand, so only build mode needs it
  // inlined here.
  const includeContext = selectedChatMode !== "local-agent";
  if (includeContext && neonProjectId && branchId) {
    try {
      prompt +=
        "\n\n" + (await getNeonContext({ projectId: neonProjectId, branchId }));
    } catch {
      // Best-effort: proceed without the live schema.
    }
  }
  return prompt;
}
