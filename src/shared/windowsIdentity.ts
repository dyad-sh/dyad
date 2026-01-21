/**
 * Windows Identity Constants
 *
 * IMPORTANT: These values control Windows taskbar icon association.
 * Squirrel.Windows creates shortcuts with AUMID pattern: com.squirrel.<name>.<name>
 * The app's setAppUserModelId() MUST match this pattern exactly.
 *
 * If these values are changed, users will need to unpin/re-pin the app
 * for the correct icon to appear on the taskbar.
 */

/**
 * The "name" field used in MakerSquirrel config (forge.config.ts).
 * This determines the NuGet package naming and Squirrel AUMID pattern.
 * Must be lowercase with underscores (no spaces or special chars).
 */
export const SQUIRREL_MAKER_NAME = "abba_ai";

/**
 * The AppUserModelId used for Windows taskbar/shortcut icon association.
 * This MUST match the Squirrel pattern: com.squirrel.<name>.<name>
 *
 * Used by:
 * - app.setAppUserModelId() in main process (early, before windows created)
 * - Squirrel shortcuts (auto-generated with this pattern)
 */
export const WINDOWS_AUMID = `com.squirrel.${SQUIRREL_MAKER_NAME}.${SQUIRREL_MAKER_NAME}`;

/**
 * Computes the expected Squirrel AUMID from a maker name.
 * Useful for verification scripts.
 */
export function computeSquirrelAumid(makerName: string): string {
  return `com.squirrel.${makerName}.${makerName}`;
}
