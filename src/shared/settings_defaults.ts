// This module is safe to import in both the main and renderer processes.
// Keep renderer-consumed defaults here free of runtime side effects.
export const DEFAULT_ENABLE_TESTING_FOR_NEW_APPS = false;
export const DEFAULT_ENABLE_PREVIEW_COOKIE_ISOLATION = true;
// Off until enabled. Kept out of DEFAULT_SETTINGS so a later default flip
// reaches users who never changed it.
export const DEFAULT_ENABLE_SUGGESTED_PROMPTS = false;

export const DEFAULT_SHOW_SYSTEM_RESOURCE_USAGE = true;

/**
 * The font used for Dyad's own UI chrome. "geist" is the built-in default;
 * the other entries are bundled via @fontsource and referenced by CSS family
 * name in src/styles/globals.css.
 */
export const DEFAULT_UI_FONT_FAMILY = "geist";

export type UiFontFamilyId = "geist" | "fraunces";

export const UI_FONT_FAMILY_IDS: readonly UiFontFamilyId[] = [
  "geist",
  "fraunces",
];

/**
 * The CSS `font-family` stack each option resolves to. Kept in one place so
 * the settings preview, the applied style, and the fallback chain cannot
 * drift apart.
 */
export const UI_FONT_FAMILY_STACKS: Record<UiFontFamilyId, string> = {
  geist: '"Geist", system-ui, sans-serif',
  fraunces: '"Fraunces Variable", Georgia, serif',
};
