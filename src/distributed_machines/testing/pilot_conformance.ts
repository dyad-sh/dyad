import { appRunConformance } from "@/app_run/conformance.test_support";
import { appRunRemoteIntentContract } from "@/app_run/remote_intent_contract";
import { imageGenerationConformance } from "@/image_generation/conformance.test_support";
import { imageGenerationRemoteIntentContract } from "@/image_generation/remote_intent_contract";
import { githubOpsConformance } from "@/github_ops/conformance.test_support";
import { githubOpsRemoteIntentContract } from "@/github_ops/remote_intent_contract";

/**
 * Test-only registration index. Protocol-v1 definitions keep their wire
 * contracts while migrated domains consume the declarative policy through the
 * narrow transport adapter.
 */
export const PILOT_CONFORMANCE_REGISTRATIONS = [
  {
    contract: appRunRemoteIntentContract,
    conformance: appRunConformance,
  },
  {
    contract: githubOpsRemoteIntentContract,
    conformance: githubOpsConformance,
  },
  {
    contract: imageGenerationRemoteIntentContract,
    conformance: imageGenerationConformance,
  },
] as const;
