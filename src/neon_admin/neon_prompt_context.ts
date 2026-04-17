import { getNeonAvailableSystemPrompt } from "../prompts/neon_prompt";
import { getCachedEmailPasswordConfig } from "./neon_management_client";
import { getNeonClientCode, getNeonContext } from "./neon_context";
import { getDyadAppPath } from "../paths/paths";
import {
  detectFrameworkType,
  detectNextJsMajorVersion,
} from "../ipc/utils/framework_utils";

interface BuildNeonPromptAdditionsParams {
  projectId: string;
  branchId?: string | null;
  frameworkType: "nextjs" | "vite" | "other" | null;
  nextjsMajorVersion?: number | null;
  includeContext: boolean;
  isLocalAgentMode: boolean;
}

export async function buildNeonPromptAdditions({
  projectId,
  branchId,
  frameworkType,
  nextjsMajorVersion = null,
  includeContext,
  isLocalAgentMode,
}: BuildNeonPromptAdditionsParams): Promise<string> {
  const neonClientCode = getNeonClientCode(frameworkType);

  let emailVerificationEnabled = false;
  if (branchId) {
    try {
      const emailConfig = await getCachedEmailPasswordConfig(
        projectId,
        branchId,
      );
      emailVerificationEnabled = emailConfig.require_email_verification;
    } catch {
      // Best-effort: proceed without email verification guidance.
    }
  }

  let neonPromptAddition = getNeonAvailableSystemPrompt(
    neonClientCode,
    frameworkType,
    {
      emailVerificationEnabled,
      nextjsMajorVersion,
      isLocalAgentMode,
    },
  );

  if (includeContext && branchId) {
    try {
      neonPromptAddition +=
        "\n\n" +
        (await getNeonContext({
          projectId,
          branchId,
        }));
    } catch {
      // Best-effort: proceed without Neon project context.
    }
  }

  return neonPromptAddition;
}

/**
 * High-level helper that computes framework type, resolves branch fallback,
 * and returns the full Neon prompt additions for a given app.
 * Use this instead of duplicating the resolve-and-call pattern.
 */
export async function buildNeonPromptForApp({
  appPath,
  neonProjectId,
  neonActiveBranchId,
  neonDevelopmentBranchId,
  selectedChatMode,
}: {
  appPath: string;
  neonProjectId: string;
  neonActiveBranchId?: string | null;
  neonDevelopmentBranchId?: string | null;
  selectedChatMode: string;
}): Promise<string> {
  const resolvedPath = getDyadAppPath(appPath);
  const frameworkType = detectFrameworkType(resolvedPath);
  const nextjsMajorVersion =
    frameworkType === "nextjs" ? detectNextJsMajorVersion(resolvedPath) : null;
  const branchId = neonActiveBranchId ?? neonDevelopmentBranchId;
  const isLocalAgent = selectedChatMode === "local-agent";
  return buildNeonPromptAdditions({
    projectId: neonProjectId,
    branchId,
    frameworkType,
    nextjsMajorVersion,
    includeContext: !isLocalAgent,
    isLocalAgentMode: isLocalAgent,
  });
}
