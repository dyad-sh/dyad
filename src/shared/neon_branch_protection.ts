import type { UserSettings } from "@/lib/schemas";
import { DEFAULT_ENABLE_NEON_BRANCH_PROTECTION } from "./settings_defaults";

/** Existing risky selections can be kept, but returning to safety removes the exception. */
export function canUseUnsafeNeonBranch(
  settings: Pick<UserSettings, "enableNeonBranchProtection"> | null | undefined,
  alreadySelected: boolean,
): boolean {
  return (
    alreadySelected ||
    !(
      settings?.enableNeonBranchProtection ??
      DEFAULT_ENABLE_NEON_BRANCH_PROTECTION
    )
  );
}
