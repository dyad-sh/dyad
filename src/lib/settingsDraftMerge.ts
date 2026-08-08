import type { UserSettings } from "./schemas";
import type { SettingsTabId } from "./settingsTabs";

const NESTED_PATCH_KEYS = [
  "experiments",
  "providerSettings",
  "modelRoles",
  "enablePro",
  "supabase",
  "storage",
] as const satisfies readonly (keyof UserSettings)[];

type NestedPatchKey = (typeof NESTED_PATCH_KEYS)[number];

/** Merges a partial settings patch into an existing partial (for tab drafts). */
export function mergeSettingsPatch(
  base: Partial<UserSettings>,
  patch: Partial<UserSettings>,
): Partial<UserSettings> {
  const next: Partial<UserSettings> = { ...base, ...patch };

  for (const key of NESTED_PATCH_KEYS) {
    const patchValue = patch[key];
    if (patchValue === undefined) continue;
    const baseValue = base[key];
    const mergedNested = {
      ...(typeof baseValue === "object" && baseValue !== null ? baseValue : {}),
      ...patchValue,
    };
    (next as Record<NestedPatchKey, UserSettings[NestedPatchKey]>)[key] =
      mergedNested as UserSettings[NestedPatchKey];
  }

  return next;
}

/** Applies a partial patch onto full saved settings (shallow + known nested keys). */
export function applySettingsPatch(
  saved: UserSettings,
  patch: Partial<UserSettings>,
): UserSettings {
  return mergeSettingsPatch(saved, patch) as UserSettings;
}

export function applyAllTabDrafts(
  saved: UserSettings,
  draftsByTab: Partial<Record<SettingsTabId, Partial<UserSettings>>>,
): UserSettings {
  return Object.values(draftsByTab).reduce<UserSettings>(
    (acc, draft) => (draft ? applySettingsPatch(acc, draft) : acc),
    saved,
  );
}

/** True when the tab draft changes any top-level field from saved values. */
export function isSettingsTabDirty(
  saved: UserSettings,
  draft: Partial<UserSettings> | undefined,
): boolean {
  if (!draft) return false;

  const effective = applySettingsPatch(saved, draft);
  for (const key of Object.keys(draft) as (keyof UserSettings)[]) {
    if (JSON.stringify(saved[key]) !== JSON.stringify(effective[key])) {
      return true;
    }
  }
  return false;
}
