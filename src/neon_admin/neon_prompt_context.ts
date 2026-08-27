import { getNeonAvailableSystemPrompt } from "../prompts/neon_prompt";
import { getCachedEmailPasswordConfig } from "./neon_management_client";
import { getNeonClientCode, getNeonContext } from "./neon_context";
import { getDyadAppPath } from "../paths/paths";
import {
  detectFrameworkType,
  detectNextJsMajorVersion,
} from "../ipc/utils/framework_utils";
import type { AppFrameworkType } from "@/lib/framework_constants";
import { isLocalAgentBackedMode, type ChatMode } from "@/lib/schemas";

interface BuildNeonPromptAdditionsParams {
  projectId: string;
  branchId?: string | null;
  frameworkType: AppFrameworkType | null;
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

  const emailVerificationEnabled = await getNeonEmailVerificationEnabled(
    projectId,
    branchId,
  );

  let neonPromptAddition = getNeonAvailableSystemPrompt(
    neonClientCode,
    frameworkType,
    {
      emailVerificationEnabled,
      nextjsMajorVersion,
      isLocalAgentMode,
      providerToolsAvailable: Boolean(branchId),
    },
  );

  if (emailVerificationEnabled === undefined) {
    neonPromptAddition += `\n\n<neon-provider-state>\nEmail-verification state could not be read. Do not assume it is disabled; inspect the live Neon Auth configuration before changing sign-up or verification behavior.\n</neon-provider-state>`;
  }

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

export async function getNeonEmailVerificationEnabled(
  projectId: string,
  branchId?: string | null,
): Promise<boolean | undefined> {
  if (!branchId) return undefined;
  try {
    const emailConfig = await getCachedEmailPasswordConfig(projectId, branchId);
    return emailConfig.require_email_verification;
  } catch {
    // Preserve the distinction between disabled and unavailable. Callers must
    // not build a non-verification flow from a failed provider lookup.
    return undefined;
  }
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
  selectedChatMode: ChatMode;
}): Promise<string> {
  const resolvedPath = getDyadAppPath(appPath);
  const frameworkType = detectFrameworkType(resolvedPath);
  const nextjsMajorVersion =
    frameworkType === "nextjs" ? detectNextJsMajorVersion(resolvedPath) : null;
  const branchId = neonActiveBranchId ?? neonDevelopmentBranchId;
  const isToolBackedMode = isLocalAgentBackedMode(selectedChatMode);
  return buildNeonPromptAdditions({
    projectId: neonProjectId,
    branchId,
    frameworkType,
    nextjsMajorVersion,
    includeContext: !isToolBackedMode,
    isLocalAgentMode: isToolBackedMode,
  });
}
