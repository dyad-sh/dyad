import log from "electron-log";
import { db } from "../../db";
import { customThemes } from "../../db/schema";
import { eq } from "drizzle-orm";
import { themesData, type Theme } from "../../shared/themes";

const logger = log.scope("theme_utils");

/**
 * Check if a theme ID refers to a custom theme.
 * Custom theme IDs are prefixed with "custom:"
 */
export function isCustomThemeId(themeId: string | null): boolean {
  return themeId?.startsWith("custom:") ?? false;
}

/**
 * Extract the numeric ID from a custom theme ID.
 * e.g., "custom:123" -> 123
 */
export function getCustomThemeNumericId(themeId: string): number | null {
  if (!isCustomThemeId(themeId)) return null;
  const numericId = parseInt(themeId.replace("custom:", ""), 10);
  return isNaN(numericId) ? null : numericId;
}

/**
 * Get a built-in theme by ID.
 */
export function getBuiltinThemeById(themeId: string | null): Theme | null {
  if (!themeId) return null;
  return themesData.find((t) => t.id === themeId) ?? null;
}

/**
 * Async function to resolve theme prompt by ID.
 * Handles both built-in themes (by ID) and custom themes (prefixed with "custom:")
 */
export async function getThemePromptById(
  themeId: string | null,
): Promise<string> {
  if (!themeId) {
    return "";
  }

  // Check if it's a custom theme
  if (isCustomThemeId(themeId)) {
    const numericId = getCustomThemeNumericId(themeId);
    if (numericId === null) {
      logger.warn(`Invalid custom theme ID: ${themeId}`);
      return "";
    }

    const customTheme = await db.query.customThemes.findFirst({
      where: eq(customThemes.id, numericId),
    });

    if (!customTheme) {
      logger.warn(`Custom theme not found: ${themeId}`);
      return "";
    }

    return customTheme.prompt;
  }

  // It's a built-in theme
  const builtinTheme = getBuiltinThemeById(themeId);
  return builtinTheme?.prompt ?? "";
}
