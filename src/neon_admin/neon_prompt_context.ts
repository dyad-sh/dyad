import { getNeonAvailableSystemPrompt } from "../prompts/neon_prompt";
import { getCachedEmailPasswordConfig } from "./neon_management_client";
import { getNeonClientCode, getNeonContext } from "./neon_context";

interface BuildNeonPromptAdditionsParams {
  projectId: string;
  branchId?: string | null;
  frameworkType: "nextjs" | "vite" | "other" | null;
  includeContext: boolean;
}

export async function buildNeonPromptAdditions({
  projectId,
  branchId,
  frameworkType,
  includeContext,
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
    },
  );

  if (includeContext && branchId) {
    try {
      neonPromptAddition +=
        "\n\n" +
        (await getNeonContext({
          projectId,
          branchId,
          frameworkType,
        }));
    } catch {
      // Best-effort: proceed without Neon project context.
    }
  }

  return neonPromptAddition;
}
