import { appRunConformance } from "@/app_run/conformance.test_support";
import { appRunRemoteIntentContract } from "@/app_run/remote_intent_contract";
import { imageGenerationConformance } from "@/image_generation/conformance.test_support";
import { imageGenerationRemoteIntentContract } from "@/image_generation/remote_intent_contract";
import { versionPreviewConformance } from "@/version_preview/conformance.test_support";
import { versionPreviewRemoteIntentContract } from "@/version_preview/remote_intent_contract";

/**
 * Test-only registration index. Production definitions remain on the existing
 * RemoteMachineContract/protocol-v1 path.
 */
export const PILOT_CONFORMANCE_REGISTRATIONS = [
  {
    contract: appRunRemoteIntentContract,
    conformance: appRunConformance,
  },
  {
    contract: imageGenerationRemoteIntentContract,
    conformance: imageGenerationConformance,
  },
  {
    contract: versionPreviewRemoteIntentContract,
    conformance: versionPreviewConformance,
  },
] as const;
